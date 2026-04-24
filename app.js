'use strict';

// ── Data ──────────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'food',      icon: '🍽️',  label: '食費' },
  { id: 'transport', icon: '🚃',  label: '交通' },
  { id: 'shopping',  icon: '🛍️',  label: '買い物' },
  { id: 'medical',   icon: '💊',  label: '医療' },
  { id: 'beauty',    icon: '💅',  label: '美容' },
  { id: 'hobby',     icon: '🎮',  label: '趣味' },
  { id: 'cafe',      icon: '☕',  label: 'カフェ' },
  { id: 'other',     icon: '📦',  label: 'その他' },
];

function storageKey() {
  const now = new Date();
  return `txs_${now.getFullYear()}_${now.getMonth() + 1}`;
}

function load() {
  const raw = localStorage.getItem(storageKey());
  return raw ? JSON.parse(raw) : [];
}
function save(txs) { localStorage.setItem(storageKey(), JSON.stringify(txs)); }
function loadSettings() { return JSON.parse(localStorage.getItem('settings') || '{}'); }
function saveSettings(s) { localStorage.setItem('settings', JSON.stringify(s)); }

// ── State ─────────────────────────────────────────────────────────────────────
let transactions = load();
let settings = loadSettings();
let selectedCategory = 'other';
let ocrWorker = null;

// ── DOM Refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dashboard      = $('dashboard');
const historyView    = $('historyView');
const settingsView   = $('settingsView');
const addModal       = $('addModal');
const bankModal      = $('bankModal');
const fabBtn         = $('fabBtn');
const settingsBtn    = $('settingsBtn');
const closeModal     = $('closeModal');
const closeBankModal = $('closeBankModal');
const backBtn        = $('backBtn');
const settingsBackBtn= $('settingsBackBtn');
const viewAllBtn     = $('viewAllBtn');
const editBankBtn    = $('editBankBtn');
const cameraBtn      = $('cameraBtn');
const cameraInput    = $('cameraInput');
const receiptPreview = $('receiptPreview');
const previewContainer = $('previewContainer');
const ocrStatus      = $('ocrStatus');
const amountInput    = $('amountInput');
const descInput      = $('descInput');
const addTransactionBtn = $('addTransactionBtn');
const budgetInput    = $('budgetInput');
const bankInput      = $('bankInput');
const saveSettingsBtn= $('saveSettingsBtn');
const saveBankBtn    = $('saveBankBtn');
const clearDataBtn   = $('clearDataBtn');
const bankModalInput = $('bankModalInput');

// ── Views ─────────────────────────────────────────────────────────────────────
function showView(view) {
  [dashboard, historyView, settingsView].forEach(v => v.classList.remove('active'));
  view.classList.add('active');
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const total = transactions.reduce((s, t) => s + t.amount, 0);
  const budget = settings.budget || 0;
  const now = new Date();
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  // Total
  $('totalAmount').textContent = '¥' + total.toLocaleString();
  $('monthLabel').textContent = `${now.getFullYear()}年${monthNames[now.getMonth()]}`;

  // Budget gauge
  $('budgetUsed').textContent = '¥' + total.toLocaleString();
  if (budget > 0) {
    const pct = Math.min((total / budget) * 100, 100);
    const remaining = budget - total;
    $('budgetLimit').textContent = '¥' + budget.toLocaleString();
    $('gaugeFill').style.width = pct + '%';
    $('gaugePercent').textContent = Math.round(pct) + '%';

    const card = $('budgetCard');
    card.className = 'card budget-card';
    const msg = $('budgetMessage');

    if (total > budget) {
      card.classList.add('state-over');
      const over = total - budget;
      msg.textContent = `💀 予算崩壊！¥${over.toLocaleString()}オーバー — 今月の財布は終了です`;
    } else if (pct >= 95) {
      card.classList.add('state-critical');
      msg.textContent = `🚨 非常事態！残り¥${remaining.toLocaleString()} — カードを今すぐ置いてください！`;
    } else if (pct >= 85) {
      card.classList.add('state-critical');
      msg.textContent = `🔴 限界警報！残り¥${remaining.toLocaleString()} — 次の一手が致命傷になります`;
    } else if (pct >= 70) {
      card.classList.add('state-danger');
      msg.textContent = `🔥 炎上中！残り¥${remaining.toLocaleString()} — 今すぐブレーキを！`;
    } else if (pct >= 50) {
      card.classList.add('state-warn');
      msg.textContent = `⚠️ 警戒ゾーン突入！残り¥${remaining.toLocaleString()} — ペースを落として`;
    } else if (total > 0) {
      card.classList.add('state-ok');
      msg.textContent = `✅ 今のところ安全。残り¥${remaining.toLocaleString()} — このペースを守って`;
    }
  } else {
    $('budgetLimit').textContent = '未設定';
    $('gaugeFill').style.width = '0%';
    $('gaugePercent').textContent = '';
    $('budgetCard').className = 'card budget-card';
    $('budgetMessage').style.display = 'none';
  }

  // Bank balance
  if (settings.bank != null && settings.bank !== '') {
    $('bankAmount').textContent = '¥' + Number(settings.bank).toLocaleString();
  } else {
    $('bankAmount').textContent = '未設定';
  }

  // Recent transactions (last 5)
  renderTxList($('recentTransactions'), transactions.slice(-5).reverse(), true);
  renderTxList($('allTransactions'), [...transactions].reverse(), false);
}

function renderTxList(container, txs, compact) {
  if (txs.length === 0) {
    container.innerHTML = '<div class="empty-state">まだ取引がありません</div>';
    return;
  }
  container.innerHTML = txs.map(tx => {
    const cat = CATEGORIES.find(c => c.id === tx.category) || CATEGORIES[7];
    const d = new Date(tx.date);
    const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `
      <div class="tx-item">
        <div class="tx-icon">${cat.icon}</div>
        <div class="tx-info">
          <div class="tx-desc">${tx.desc || cat.label}</div>
          <div class="tx-meta">${dateStr} · ${cat.label}</div>
        </div>
        <div class="tx-amount">¥${tx.amount.toLocaleString()}</div>
        ${compact ? '' : `<button class="tx-delete" data-id="${tx.id}" title="削除">✕</button>`}
      </div>`;
  }).join('');

  if (!compact) {
    container.querySelectorAll('.tx-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('この取引を削除しますか？')) {
          transactions = transactions.filter(t => t.id !== btn.dataset.id);
          save(transactions);
          render();
        }
      });
    });
  }
}

// ── Category Grid ─────────────────────────────────────────────────────────────
function renderCategories() {
  $('categoryGrid').innerHTML = CATEGORIES.map(c => `
    <button class="cat-btn ${c.id === selectedCategory ? 'selected' : ''}" data-id="${c.id}">
      <span>${c.icon}</span>
      <span>${c.label}</span>
    </button>`).join('');
  $('categoryGrid').querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategory = btn.dataset.id;
      renderCategories();
    });
  });
}

// ── Add Transaction ───────────────────────────────────────────────────────────
function openAddModal() {
  amountInput.value = '';
  descInput.value = '';
  selectedCategory = 'other';
  previewContainer.style.display = 'none';
  receiptPreview.src = '';
  ocrStatus.textContent = '';
  renderCategories();
  addModal.classList.add('open');
  setTimeout(() => amountInput.focus(), 400);
}
function closeAddModal() { addModal.classList.remove('open'); }

addTransactionBtn.addEventListener('click', () => {
  const amount = parseInt(amountInput.value);
  if (!amount || amount <= 0) { amountInput.focus(); return; }
  transactions.push({
    id: Date.now().toString(),
    amount,
    desc: descInput.value.trim(),
    category: selectedCategory,
    date: new Date().toISOString(),
  });
  save(transactions);
  render();
  closeAddModal();
});

// ── OCR ───────────────────────────────────────────────────────────────────────
cameraBtn.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Show preview
  const url = URL.createObjectURL(file);
  receiptPreview.src = url;
  previewContainer.style.display = 'block';
  ocrStatus.textContent = '📖 読み取り中... しばらくお待ちください';
  amountInput.value = '';

  try {
    const result = await Tesseract.recognize(file, 'jpn+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          ocrStatus.textContent = `📖 読み取り中... ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    const text = result.data.text;
    const amount = extractAmount(text);

    if (amount) {
      amountInput.value = amount;
      ocrStatus.textContent = `✅ ¥${Number(amount).toLocaleString()} を読み取りました。確認してください。`;
    } else {
      ocrStatus.textContent = '⚠️ 金額を読み取れませんでした。手動で入力してください。';
    }
  } catch (err) {
    ocrStatus.textContent = '❌ 読み取りに失敗しました。手動で入力してください。';
    console.error(err);
  }

  // Reset input so same file can be selected again
  cameraInput.value = '';
});

function extractAmount(text) {
  // Look for total patterns in Japanese receipts
  const patterns = [
    /(?:税込合計|合計金額|お合計|ご合計|合計|お支払い|お支払合計|小計|総合計)[^\d]*([0-9,，]+)/gi,
    /(?:total|amount)[^\d]*([0-9,]+)/gi,
    /¥\s*([0-9,，]+)/g,
    /([0-9,，]{3,})/g, // fallback: find all numbers >= 3 digits
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      // Take the last match (totals usually appear at bottom)
      const raw = matches[matches.length - 1][1].replace(/[,，]/g, '');
      const num = parseInt(raw);
      if (num > 0 && num < 10000000) return num;
    }
  }
  return null;
}

// ── Settings ──────────────────────────────────────────────────────────────────
saveSettingsBtn.addEventListener('click', () => {
  const b = parseInt(budgetInput.value);
  const bk = parseInt(bankInput.value);
  if (!isNaN(b) && b > 0) settings.budget = b;
  if (!isNaN(bk)) settings.bank = bk;
  saveSettings(settings);
  render();
  showView(dashboard);
});

clearDataBtn.addEventListener('click', () => {
  if (confirm('今月の取引データをすべて削除しますか？')) {
    transactions = [];
    save(transactions);
    render();
    showView(dashboard);
  }
});

// Bank modal
editBankBtn.addEventListener('click', () => {
  bankModalInput.value = settings.bank || '';
  bankModal.classList.add('open');
  setTimeout(() => bankModalInput.focus(), 300);
});
closeBankModal.addEventListener('click', () => bankModal.classList.remove('open'));
saveBankBtn.addEventListener('click', () => {
  const v = parseInt(bankModalInput.value);
  if (!isNaN(v)) { settings.bank = v; saveSettings(settings); render(); }
  bankModal.classList.remove('open');
});

// ── Navigation ────────────────────────────────────────────────────────────────
fabBtn.addEventListener('click', openAddModal);
closeModal.addEventListener('click', closeAddModal);
addModal.addEventListener('click', e => { if (e.target === addModal) closeAddModal(); });
bankModal.addEventListener('click', e => { if (e.target === bankModal) bankModal.classList.remove('open'); });

settingsBtn.addEventListener('click', () => {
  budgetInput.value = settings.budget || '';
  bankInput.value = settings.bank || '';
  showView(settingsView);
});
settingsBackBtn.addEventListener('click', () => showView(dashboard));
backBtn.addEventListener('click', () => showView(dashboard));
viewAllBtn.addEventListener('click', () => showView(historyView));

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────────────────────
render();
