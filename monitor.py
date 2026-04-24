import json
import os
import smtplib
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

RAKUTEN_APP_ID = os.environ['RAKUTEN_APP_ID']
GMAIL_ADDRESS = os.environ['GMAIL_ADDRESS']
GMAIL_APP_PASSWORD = os.environ['GMAIL_APP_PASSWORD']

STATE_FILE = 'state.json'
CONFIG_FILE = 'config.json'


def load_json(filepath, default=None):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}


def save_json(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_item_info(item_code):
    url = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601'
    params = {
        'applicationId': RAKUTEN_APP_ID,
        'itemCode': item_code,
        'hits': 1,
        'format': 'json',
    }
    try:
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
        if data.get('Items'):
            return data['Items'][0]['Item']
    except Exception as e:
        print(f"商品取得エラー ({item_code}): {e}")
    return None


def get_shop_coupons(shop_code):
    url = 'https://app.rakuten.co.jp/services/api/Coupon/Search/20121227'
    params = {
        'applicationId': RAKUTEN_APP_ID,
        'shopCode': shop_code,
        'hits': 10,
        'format': 'json',
    }
    try:
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
        return data.get('coupons', [])
    except Exception as e:
        print(f"クーポン取得エラー ({shop_code}): {e}")
    return []


def send_email(subject, body):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_ADDRESS
    msg['To'] = GMAIL_ADDRESS
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain', 'utf-8'))
    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
        smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        smtp.send_message(msg)


def check_items(config, state):
    notifications = []
    items_state = state.setdefault('items', {})

    for item in config.get('items', []):
        item_code = item['item_code']
        item_name = item['name']

        info = get_item_info(item_code)
        if not info:
            continue

        current_price = info.get('itemPrice', 0)
        current_point_rate = info.get('pointRate', 1)
        item_url = info.get('itemUrl', '')

        prev = items_state.get(item_code, {})
        prev_price = prev.get('price')
        prev_point_rate = prev.get('point_rate', 1)

        # 値下げ検知
        if prev_price and current_price < prev_price:
            diff = prev_price - current_price
            notifications.append(
                f"【値下げ】{item_name}\n"
                f"  {prev_price:,}円 → {current_price:,}円（{diff:,}円引き）\n"
                f"  {item_url}"
            )

        # ポイント倍率アップ検知
        if current_point_rate > prev_point_rate and current_point_rate > 1:
            notifications.append(
                f"【ポイントアップ】{item_name}\n"
                f"  ポイント倍率: {prev_point_rate}倍 → {current_point_rate}倍\n"
                f"  {item_url}"
            )

        items_state[item_code] = {
            'price': current_price,
            'point_rate': current_point_rate,
            'name': item_name,
            'updated_at': datetime.now().isoformat(),
        }

    return notifications


def check_coupons(config, state):
    notifications = []
    shops_state = state.setdefault('shops', {})

    for shop in config.get('shops', []):
        shop_code = shop['shop_code']
        shop_name = shop['name']

        coupons = get_shop_coupons(shop_code)
        prev_coupon_ids = set(shops_state.get(shop_code, {}).get('coupon_ids', []))
        current_coupon_ids = set()
        new_coupons = []

        for entry in coupons:
            c = entry.get('coupon', entry)
            coupon_id = str(c.get('couponId', ''))
            if coupon_id:
                current_coupon_ids.add(coupon_id)
                if coupon_id not in prev_coupon_ids:
                    new_coupons.append(c)

        if new_coupons:
            details = '\n'.join(
                f"  ・{c.get('couponTitle', 'クーポン')}"
                + (f"  {c['discountPrice']:,}円引き" if c.get('discountPrice') else '')
                + (f"  {c['discountRate']}%引き" if c.get('discountRate') else '')
                for c in new_coupons
            )
            notifications.append(f"【新規クーポン】{shop_name}\n{details}")

        shops_state[shop_code] = {
            'coupon_ids': list(current_coupon_ids),
            'updated_at': datetime.now().isoformat(),
        }

    return notifications


def main():
    config = load_json(CONFIG_FILE, {'items': [], 'shops': []})
    state = load_json(STATE_FILE, {})

    notifications = []
    notifications.extend(check_items(config, state))
    notifications.extend(check_coupons(config, state))

    save_json(STATE_FILE, state)

    if notifications:
        body = '\n\n'.join(notifications)
        body += f'\n\n---\n{datetime.now().strftime("%Y/%m/%d %H:%M")} チェック完了'
        send_email('【楽天モニター】お知らせがあります', body)
        print(f"通知送信: {len(notifications)}件")
    else:
        print(f"{datetime.now().strftime('%Y/%m/%d %H:%M')} 変化なし")


if __name__ == '__main__':
    main()
