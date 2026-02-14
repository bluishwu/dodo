const i18n = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;

let pendingList = [];
let flowList = []; 
let draggedItemIndex = null;
let editingId = null; 
let uiState = {
  isDocked: true,
  isCollapsed: true,
  activeTab: 'pending', 
  top: 80,
  left: null
};

const isGemini = window.location.hostname.includes('gemini.google.com');
const isChatGPT = window.location.hostname.includes('chatgpt.com');

const SELECTORS = {
  chatgpt: {
    input: '#prompt-textarea',
    articles: 'article',
    roleAssistant: '[data-message-author-role="assistant"]',
    roleUser: '[data-message-author-role="user"]',
    sendBtn: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
    messageContent: '.markdown'
  },
  gemini: {
    input: 'div[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"]',
    articles: 'user-query, model-response',
    roleAssistant: 'model-response',
    roleUser: 'user-query',
    sendBtn: 'button[aria-label="Send message"], .send-button',
    messageContent: '.message-content, .query-text'
  }
};

const currentConfig = isGemini ? SELECTORS.gemini : SELECTORS.chatgpt;

let flowObserver = null;

chrome.storage.local.get(['pendingList', 'uiState'], (result) => {
  if (result.pendingList) pendingList = result.pendingList;
  if (result.uiState) uiState = { ...uiState, ...result.uiState };
  renderList();
});

function saveList() { chrome.storage.local.set({ pendingList }); }
function saveUIState() { chrome.storage.local.set({ uiState }); }

function injectUI() {
  if (document.getElementById('gpt-pending-list-container')) return;

  const container = document.createElement('div');
  container.id = 'gpt-pending-list-container';
  
  if (uiState.isDocked) {
    container.classList.add('docked');
    container.style.top = uiState.top + 'px';
    if (uiState.isCollapsed) container.classList.add('collapsed');
  } else {
    container.style.top = uiState.top + 'px';
    container.style.left = uiState.left ? uiState.left + 'px' : (window.innerWidth - 380) + 'px';
    if (uiState.isCollapsed) container.classList.add('collapsed');
  }

  container.innerHTML = `
    <div class="toggle-sidebar" title="${i18n('toggleList')}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>
    </div>

    <div class="floating-icon-view" title="${i18n('expand')}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>
    </div>

    <div class="unified-header">
      <div class="header-left-actions">
        <div class="header-chevron" title="${i18n('collapse')}">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>
        <div class="tab-container">
          <div class="tab-item ${uiState.activeTab === 'pending' ? 'active' : ''}" data-tab="pending">${i18n('tabQueue')}</div>
          <div class="tab-item ${uiState.activeTab === 'flow' ? 'active' : ''}" data-tab="flow">${i18n('tabFlow')}</div>
        </div>
      </div>
      <div class="minimize-btn" title="${i18n('minimize')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </div>
    </div>

    <div class="pending-list-content" id="pending-items-container"></div>
    
    <div class="pending-input-area" style="${uiState.activeTab === 'flow' ? 'display:none;' : ''}">
      <textarea class="pending-textarea" placeholder="${i18n('inputPlaceholder')}"></textarea>
      <button class="add-pending-btn">${i18n('addToList')}</button>
    </div>
  `;

  document.body.appendChild(container);
  makeDraggable(container);

  container.querySelector('.toggle-sidebar').addEventListener('click', () => toggleCollapse(container));
  container.querySelector('.floating-icon-view').addEventListener('click', () => {
    if (!container.classList.contains('dragging')) {
      container.classList.remove('collapsed');
      uiState.isCollapsed = false;
      saveUIState();
    }
  });
  
  const collapseAction = (e) => {
    e.stopPropagation();
    container.classList.add('collapsed');
    uiState.isCollapsed = true;
    saveUIState();
  };
  container.querySelector('.minimize-btn').addEventListener('click', collapseAction);
  container.querySelector('.header-chevron').addEventListener('click', collapseAction);

  container.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabEl = e.target.closest('.tab-item');
      const targetTab = tabEl.dataset.tab;
      if (targetTab !== uiState.activeTab) {
        uiState.activeTab = targetTab;
        saveUIState();
        updateTabs(container);
        renderList();
        if (targetTab === 'flow') scanConversation(); else disconnectFlowObserver();
      }
    });
  });

  const textarea = container.querySelector('.pending-textarea');
  const addBtn = container.querySelector('.add-pending-btn');

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  });

  const handleAdd = () => {
    const text = textarea.value.trim();
    if (text) {
      addPendingItem(text);
      textarea.value = '';
      textarea.style.height = 'auto';
    }
  };

  addBtn.addEventListener('click', handleAdd);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd();
  });

  renderList();
  startConversationObserver();
}

function toggleCollapse(container) {
  container.classList.toggle('collapsed');
  uiState.isCollapsed = container.classList.contains('collapsed');
  saveUIState();
}

function updateTabs(container) {
  container.querySelectorAll('.tab-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === uiState.activeTab);
  });
  const inputArea = container.querySelector('.pending-input-area');
  if (inputArea) inputArea.style.display = uiState.activeTab === 'pending' ? 'block' : 'none';
}

function makeDraggable(element) {
  const header = element.querySelector('.unified-header');
  const iconView = element.querySelector('.floating-icon-view');
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  const onMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('.minimize-btn') || e.target.closest('.header-chevron') || e.target.closest('.tab-item')) return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = element.getBoundingClientRect();
    initialLeft = rect.left; initialTop = rect.top;
    element.classList.add('dragging');
    if (element.classList.contains('docked')) {
      element.classList.remove('docked', 'collapsed'); 
      element.style.left = initialLeft + 'px';
      element.style.right = 'auto';
      uiState.isDocked = false; uiState.isCollapsed = false;
    }
  };

  header.addEventListener('mousedown', onMouseDown);
  iconView.addEventListener('mousedown', onMouseDown);

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    let newLeft = Math.max(0, Math.min(initialLeft + (e.clientX - startX), window.innerWidth - element.offsetWidth + 100));
    let newTop = Math.max(0, Math.min(initialTop + (e.clientY - startY), window.innerHeight - element.offsetHeight));
    element.style.left = newLeft + 'px';
    element.style.top = newTop + 'px';
  });

  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    element.classList.remove('dragging');
    const rect = element.getBoundingClientRect();
    if (window.innerWidth - rect.right < 50) {
      element.classList.add('docked', 'collapsed');
      element.style.left = 'auto'; element.style.right = ''; 
      uiState.isDocked = true; uiState.isCollapsed = true;
    } else {
      uiState.isDocked = false; uiState.left = rect.left;
    }
    uiState.top = rect.top;
    saveUIState();
  });
}

function addPendingItem(text) {
  pendingList.push({ id: Date.now().toString(), text: text });
  saveList(); renderList();
}

function startEditing(id) {
  editingId = id;
  renderList();
  setTimeout(() => {
    const container = document.getElementById('pending-items-container');
    const itemEl = container.querySelector(`.pending-item.editing[data-id="${id}"]`);
    const textarea = itemEl?.querySelector('.edit-textarea');
    if (textarea) {
      autoResizeTextarea(textarea);
      textarea.addEventListener('input', () => autoResizeTextarea(textarea));
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          const newText = textarea.value.trim();
          if (newText) {
            const item = pendingList.find(p => p.id === id);
            if (item) item.text = newText;
            saveList();
          }
          editingId = null; renderList();
        }
      });
      textarea.focus();
      const val = textarea.value; textarea.value = ''; textarea.value = val;
    }
  }, 10);
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function startConversationObserver() {
  scanConversation();
  let timeout;
  const observer = new MutationObserver(() => {
    clearTimeout(timeout);
    timeout = setTimeout(scanConversation, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function scanConversation() {
  const articles = document.querySelectorAll(currentConfig.articles);
  const newList = [];
  
  articles.forEach((article, index) => {
    let isUser = false;
    if (isChatGPT) {
      isUser = !!article.querySelector(currentConfig.roleUser);
    } else if (isGemini) {
      isUser = article.tagName.toLowerCase() === 'user-query';
    }
    
    if (isUser) {
      const textElement = article.querySelector(currentConfig.messageContent) || article;
      let preview = textElement.innerText.slice(0, 100).replace(/\n/g, ' ') || i18n('noText');
      preview = preview.replace(/^(You said|你说)[:：]?\s*/i, '');
      
      const hasImage = !!article.querySelector('img, .image-attachment, [data-testid="image-attachment"], .chip-image');
      
      newList.push({
        id: index, text: preview, hasImage: hasImage, element: article 
      });
    }
  });
  
  const isDifferent = newList.length !== flowList.length || newList.some((item, i) => item.text !== flowList[i]?.text);

  if (isDifferent) {
    flowList = newList;
    if (uiState.activeTab === 'flow') { renderList(); observeFlowVisibility(); }
  } else if (uiState.activeTab === 'flow' && !flowObserver) {
    observeFlowVisibility();
  }
}

function observeFlowVisibility() {
  disconnectFlowObserver();
  flowObserver = new IntersectionObserver((entries) => {
    const visibleEntry = entries.find(entry => entry.isIntersecting);
    if (visibleEntry) {
      document.querySelectorAll('.outline-item.active').forEach(el => el.classList.remove('active'));
      const index = flowList.findIndex(item => item.element === visibleEntry.target);
      if (index !== -1) {
        const item = document.querySelector(`.outline-item[data-flow-index="${index}"]`);
        if (item) item.classList.add('active');
      }
    }
  }, { root: null, threshold: 0.1 });
  flowList.forEach(item => item.element && flowObserver.observe(item.element));
}

function disconnectFlowObserver() { if (flowObserver) { flowObserver.disconnect(); flowObserver = null; } }

function renderList() {
  const container = document.getElementById('pending-items-container');
  if (!container) return;
  container.innerHTML = '';
  if (uiState.activeTab === 'flow') renderFlow(container); else renderPending(container);
}

function renderFlow(container) {
  if (flowList.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:#aaa; padding: 20px; font-size:12px;">${i18n('noPromptsFound', isGemini ? 'Gemini' : 'ChatGPT')}</div>`;
    return;
  }
  flowList.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = `outline-item`; el.dataset.flowIndex = index;
    const imgIcon = item.hasImage ? `<span class="flow-img-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>` : '';
    el.innerHTML = `<div class="outline-left"><div class="flow-index">${index + 1}</div></div><div class="outline-text">${imgIcon}${escapeHtml(item.text)}</div>`;
    el.addEventListener('click', () => item.element.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    container.appendChild(el);
  });
  if (uiState.activeTab === 'flow') observeFlowVisibility();
}

function renderPending(container) {
  const iconEdit = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
  const iconSend = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`;
  const iconFill = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`;
  const iconDelete = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

  pendingList.forEach((item, index) => {
    const isEditing = editingId === item.id;
    const itemEl = document.createElement('div');
    itemEl.className = `pending-item ${isEditing ? 'editing' : ''}`;
    itemEl.draggable = !isEditing; itemEl.dataset.index = index; itemEl.dataset.id = item.id;
    
    if (isEditing) {
      itemEl.innerHTML = `<div class="item-left"><div class="item-number">${index + 1}</div></div><textarea class="edit-textarea">${item.text}</textarea><div class="pending-item-actions visible"><button class="pending-btn save" data-action="save">OK</button><button class="pending-btn" data-action="cancel">✕</button></div>`;
    } else {
      itemEl.innerHTML = `<div class="item-left"><div class="item-number">${index + 1}</div></div><div class="pending-item-text">${escapeHtml(item.text)}</div><div class="pending-item-actions"><button class="pending-btn" data-action="edit" title="${i18n('tipEdit')}">${iconEdit}</button><button class="pending-btn" data-action="use" title="${i18n('tipFill')}">${iconFill}</button><button class="pending-btn primary" data-action="send" title="${i18n('tipSend')}">${iconSend}</button><button class="pending-btn danger" data-action="delete" title="${i18n('tipDelete')}">${iconDelete}</button></div>`;
    }

    if (!isEditing) {
      itemEl.addEventListener('dblclick', () => startEditing(item.id));
      itemEl.addEventListener('dragstart', (e) => { draggedItemIndex = index; itemEl.classList.add('dragging'); });
      itemEl.addEventListener('dragend', () => { itemEl.classList.remove('dragging'); draggedItemIndex = null; });
      itemEl.addEventListener('dragover', (e) => e.preventDefault());
      itemEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetIndex = parseInt(itemEl.dataset.index);
        if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
          const movedItem = pendingList.splice(draggedItemIndex, 1)[0];
          pendingList.splice(targetIndex, 0, movedItem);
          saveList(); renderList();
        }
      });
    }

    itemEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const action = btn?.dataset.action;
      if (!action) return;
      e.stopPropagation();
      if (action === 'delete') { pendingList.splice(index, 1); saveList(); renderList(); }
      else if (action === 'edit') { startEditing(item.id); }
      else if (action === 'save') {
        const newText = itemEl.querySelector('.edit-textarea').value.trim();
        if (newText) { const p = pendingList.find(pi => pi.id === item.id); if(p) p.text = newText; saveList(); }
        editingId = null; renderList();
      }
      else if (action === 'cancel') { editingId = null; renderList(); }
      else if (action === 'use') { fillIntoAI(item.text); }
      else if (action === 'send') {
        fillIntoAI(item.text);
        setTimeout(() => {
          const btnSend = document.querySelector(currentConfig.sendBtn);
          if (btnSend) { btnSend.click(); pendingList.splice(index, 1); saveList(); renderList(); }
        }, 150);
      }
    });
    container.appendChild(itemEl);
  });
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

function fillIntoAI(text) {
  const el = document.querySelector(currentConfig.input);
  if (el) {
    el.focus();
    if (isChatGPT) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (isGemini) {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

const checkInterval = setInterval(() => { if (document.body) { injectUI(); clearInterval(checkInterval); } }, 1000);
