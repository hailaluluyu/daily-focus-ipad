'use strict';

const STORAGE_KEY = 'daymark.appState.v1';
const REASONS = ['松懈', '取消', '延后'];
const EMPTY = () => ({ schemaVersion: 1, tasks: [], categories: [], sessions: [], reviewedDateKeys: [] });
const $ = (selector, root = document) => root.querySelector(selector);
const content = $('#content');
let state = readState();
let tab = 'plan';
let selectedDate = dateKey(new Date());
let selectedMonth = monthKey(new Date());
let timeRange = 'week';
let timeAnchor = selectedDate;
let reviewing = false;
let reviewDraft = {};
let reviewReasons = {};
let editingTaskId = '';
let editingCategoryId = '';
let toastTimer;

function readState() {
  const nativeState = window.__DAYMARK_NATIVE_STATE__;
  if (nativeState && nativeState.schemaVersion === 1 && Array.isArray(nativeState.tasks) && Array.isArray(nativeState.categories) && Array.isArray(nativeState.sessions)) {
    return { ...EMPTY(), ...nativeState, reviewedDateKeys: Array.isArray(nativeState.reviewedDateKeys) ? nativeState.reviewedDateKeys : [] };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.schemaVersion === 1 && Array.isArray(saved.tasks) && Array.isArray(saved.categories) && Array.isArray(saved.sessions)) {
      return { ...EMPTY(), ...saved, reviewedDateKeys: Array.isArray(saved.reviewedDateKeys) ? saved.reviewedDateKeys : [] };
    }
  } catch (_) { /* Storage may be disabled in private browsing. */ }
  return EMPTY();
}

function persist() {
  const nativeHandler = window.webkit?.messageHandlers?.daymarkState;
  if (nativeHandler) {
    nativeHandler.postMessage(JSON.stringify(state));
    window.__DAYMARK_NATIVE_STATE__ = state;
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (_) { toast('无法写入浏览器本机存储，请检查 Safari 的网站数据设置。'); }
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function monthKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; }
function pad(value) { return String(value).padStart(2, '0'); }
function parseDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function shiftDate(key, amount) { const date = parseDate(key); date.setDate(date.getDate() + amount); return dateKey(date); }
function shiftMonth(key, amount) { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 + amount, 1, 12)); }
function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.floor(Math.random() * 1e9)}`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function localDateLabel(key) { return parseDate(key).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); }
function duration(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时 ${rest} 分钟`;
  return hours ? `${hours} 小时 ${rest} 分钟` : `${rest} 分钟`;
}
function tasksForDate(key) {
  return state.tasks.filter(task => task.dateKey === key).slice().sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99') || a.createdAt - b.createdAt);
}
function activeSession() { return state.sessions.find(session => session.endedAt === null); }
function taskState(task) { return reviewDraft[task.id] ?? task.status; }
function taskReason(task) { return reviewReasons[task.id] ?? task.reason ?? null; }
function toast(message) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}
function isToday(key) { return key === dateKey(new Date()); }
function isReviewDue() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= 21 * 60 + 30 && !state.reviewedDateKeys.includes(dateKey(now)) && tasksForDate(dateKey(now)).length > 0;
}

function render() {
  $('#headerDate').innerHTML = `<strong>${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</strong>${new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}`;
  const labels = {
    plan: ['PLAN YOUR DAY', '把今天过得更清晰'],
    focus: ['TIME WELL SPENT', '时间花在想做的事上'],
    stats: ['SMALL STEPS ADD UP', '看见一点点进步'],
    data: ['YOUR DATA', '备份与迁移']
  };
  $('#pageEyebrow').textContent = labels[tab][0];
  $('#pageTitle').textContent = labels[tab][1];
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  const due = isReviewDue();
  $('#reminder').classList.toggle('hidden', !due);
  if (tab === 'plan') renderPlan();
  else if (tab === 'focus') renderFocus();
  else if (tab === 'stats') renderStats();
  else renderData();
}

function renderPlan() {
  const tasks = tasksForDate(selectedDate);
  const done = tasks.filter(task => task.status === 'completed').length;
  const incomplete = tasks.filter(task => task.status === 'incomplete').length;
  const reviewed = state.reviewedDateKeys.includes(selectedDate);
  $('#headingAction').innerHTML = `<button class="button button-primary" data-action="add-task">＋ 安排任务</button>`;
  let taskHtml = '';
  if (!tasks.length) taskHtml = `<div class="empty"><strong>还没有计划任务</strong>添加一件今天想完成的事吧。</div>`;
  else if (!reviewing) taskHtml = `<div class="task-list">${tasks.map(task => `
    <article class="task-card"><div class="task-time">${task.startTime ? `${esc(task.startTime)}–${esc(task.endTime)}` : '未安排时间'}<small>${task.status === 'completed' ? '已完成' : task.status === 'incomplete' ? `未完成 · ${esc(task.reason || '待填写理由')}` : '待复盘'}</small></div>
      <div><div class="task-name">${esc(task.title)}</div>${task.status === 'completed' ? '<div class="task-state">今天的计划完成得很好</div>' : ''}</div>
      <div class="task-actions"><button class="text-button" data-action="edit-task" data-id="${esc(task.id)}">编辑</button><button class="text-button danger" data-action="delete-task" data-id="${esc(task.id)}">删除</button></div></article>`).join('')}</div>`;
  else taskHtml = `<div class="panel review-box"><h2 class="section-title">逐项回顾 <span class="fine">完成情况和未完成理由都可以修改</span></h2>${tasks.map(task => {
    const status = taskState(task);
    return `<div class="review-row"><div><div class="task-name">${esc(task.title)}</div><div class="task-state">${task.startTime ? `${esc(task.startTime)}–${esc(task.endTime)}` : '未安排时间'}</div></div>
    <div class="review-options"><label class="choice"><input type="radio" name="status-${esc(task.id)}" data-action="review-status" data-id="${esc(task.id)}" value="completed" ${status === 'completed' ? 'checked' : ''}>已完成</label><label class="choice"><input type="radio" name="status-${esc(task.id)}" data-action="review-status" data-id="${esc(task.id)}" value="incomplete" ${status === 'incomplete' ? 'checked' : ''}>未完成</label></div>
    ${status === 'incomplete' ? `<div class="reason-options">${REASONS.map(reason => `<button class="reason-chip ${taskReason(task) === reason ? 'selected' : ''}" data-action="reason" data-id="${esc(task.id)}" data-reason="${reason}">${reason}</button>`).join('')}</div>` : ''}</div>`;
  }).join('')}</div>`;
  $('#content').innerHTML = `<div class="date-nav panel"><button aria-label="前一天" data-action="shift-day" data-delta="-1">‹</button><div class="date-label">${esc(localDateLabel(selectedDate))}<small>${selectedDate === dateKey(new Date()) ? '今天' : selectedDate}</small></div><button aria-label="后一天" data-action="shift-day" data-delta="1">›</button><button class="text-button" data-action="today">回到今天</button><label class="fine">跳转 <input type="date" id="planDate" value="${esc(selectedDate)}" aria-label="选择日期"></label></div>
    <div class="plan-layout"><section class="plan-main"><div class="plan-summary"><div><p>${reviewed ? '今日复盘已提交，可随时修改' : reviewing ? '逐项选择完成情况' : '今日计划进度'}</p><strong>${reviewing ? '晚间复盘' : `${done} / ${tasks.length} 完成`}</strong></div><div class="summary-pills"><span class="pill">未完成 ${incomplete}</span><span class="pill">待复盘 ${tasks.length - done - incomplete}</span></div></div>
      ${reviewing ? taskHtml : taskHtml}</section><aside class="plan-side">${tasks.length ? `<div class="panel"><h2 class="section-title">${reviewing ? '完成后提交' : '今日回顾'}</h2><p class="data-note">未完成任务需要选择一个固定理由：松懈、取消或延后。延后只记录原因，后续日期由你自行安排。</p>${reviewing ? '<button class="button button-primary" style="width:100%" data-action="submit-review">保存今日总结</button><button class="text-button" style="width:100%" data-action="cancel-review">暂不提交</button>' : `<button class="button button-primary" style="width:100%" data-action="begin-review">${reviewed ? '修改复盘' : '开始晚间复盘'}</button>`}</div>` : ''}<div class="panel"><h2 class="section-title">小提示</h2><p class="data-note">按时间段排序；没有时间的任务会列在后面。时间冲突会提醒你，但仍可保存。</p></div></aside></div>`;
}

function renderFocus() {
  const running = activeSession();
  const active = state.categories.filter(category => category.active);
  const inactive = state.categories.filter(category => !category.active);
  const recent = state.sessions.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);
  $('#headingAction').innerHTML = '<button class="button button-primary" data-action="add-category">＋ 新建投入项</button>';
  $('#content').innerHTML = `<div class="focus-layout"><section><div class="focus-current"><div><p>正在投入</p><strong id="runningLabel">${running ? `${esc(running.categoryNameSnapshot)} · ${duration(Date.now() - running.startedAt)}` : '还没有开始计时'}</strong></div><i class="pulse ${running ? 'running' : ''}"></i></div>
    <div class="section-title">投入项目 <span class="fine">点击开始，再次点击结束</span></div>${active.length ? `<div class="category-list">${active.map(category => { const isRunning = running?.categoryId === category.id; return `<article class="category-card ${isRunning ? 'running' : ''}"><button class="start-button" aria-label="${isRunning ? '停止' : '开始'}${esc(category.name)}" data-action="toggle-category" data-id="${esc(category.id)}">${isRunning ? '■' : '▶'}</button><div class="category-info"><strong>${esc(category.name)}</strong><small>${isRunning ? '正在计时 · 再次点击结束' : '点击开始计时'}</small></div><div class="category-tools"><button class="text-button" data-action="edit-category" data-id="${esc(category.id)}">改名</button><button class="text-button danger" data-action="deactivate-category" data-id="${esc(category.id)}">停用</button></div></article>`; }).join('')}</div>` : '<div class="empty"><strong>建立一个投入项目</strong>例如：阅读、运动、工作或学习。</div>'}
    ${inactive.length ? `<details style="margin-top:16px"><summary class="fine">已停用项目（${inactive.length}）</summary><div class="category-list" style="margin-top:10px">${inactive.map(category => `<article class="category-card"><div class="category-info"><strong>${esc(category.name)}</strong><small>已停用，历史记录仍保留</small></div><button class="text-button" data-action="activate-category" data-id="${esc(category.id)}">重新启用</button></article>`).join('')}</div></details>` : ''}</section>
    <section class="panel"><h2 class="section-title">最近记录 <span class="fine">最近 8 段</span></h2>${recent.length ? `<div class="recent-list">${recent.map(session => `<div class="session-row"><span><strong>${esc(session.categoryNameSnapshot)}</strong><br><small>${new Date(session.startedAt).toLocaleDateString('zh-CN')} · ${new Date(session.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></span><strong>${session.endedAt === null ? '进行中' : duration(session.endedAt - session.startedAt)}</strong></div>`).join('')}</div>` : '<p class="data-note">开始一次计时后，记录会显示在这里。</p>'}</section></div>`;
}

function monthPlanStats(key) {
  const [year, month] = key.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  const all = state.tasks.filter(task => task.dateKey.startsWith(`${key}-`));
  const completed = all.filter(task => task.status === 'completed').length;
  const incomplete = all.filter(task => task.status === 'incomplete');
  const pending = all.filter(task => task.status === 'unreviewed').length;
  const reviewed = completed + incomplete.length;
  return { year, month, days, all, completed, incomplete, pending, reviewed, rate: reviewed ? completed / reviewed : 0 };
}

function periodBounds(range, anchor) {
  const date = parseDate(anchor);
  let start;
  let end;
  if (range === 'day') { start = new Date(date.getFullYear(), date.getMonth(), date.getDate()); end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1); }
  else if (range === 'week') { const weekday = (date.getDay() + 6) % 7; start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday); end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7); }
  else { start = new Date(date.getFullYear(), date.getMonth(), 1); end = new Date(date.getFullYear(), date.getMonth() + 1, 1); }
  return { start: start.getTime(), end: end.getTime(), startDate: dateKey(start), endDate: dateKey(new Date(end.getTime() - 1)) };
}

function timeStats(range, anchor) {
  const bounds = periodBounds(range, anchor);
  const byCategory = new Map();
  const byDay = new Map();
  const bySessionDay = new Map();
  let total = 0;
  const categories = new Map(state.categories.map(item => [item.id, item.name]));
  for (const session of state.sessions) {
    let cursor = Math.max(session.startedAt, bounds.start);
    const finish = Math.min(session.endedAt ?? Date.now(), bounds.end);
    if (finish <= cursor) continue;
    const key = session.categoryId;
    let categoryTotal = 0;
    while (cursor < finish) {
      const d = new Date(cursor);
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const segmentEnd = Math.min(finish, nextMidnight);
      const amount = segmentEnd - cursor;
      const day = dateKey(d);
      byDay.set(day, (byDay.get(day) || 0) + amount);
      categoryTotal += amount;
      const sessionKey = `${day}|${key}`;
      bySessionDay.set(sessionKey, (bySessionDay.get(sessionKey) || 0) + amount);
      cursor = segmentEnd;
    }
    byCategory.set(key, (byCategory.get(key) || 0) + categoryTotal);
    total += categoryTotal;
  }
  const categoriesStats = [...byCategory].map(([categoryId, ms]) => ({ categoryId, name: categories.get(categoryId) || state.sessions.find(s => s.categoryId === categoryId)?.categoryNameSnapshot || '已停用项目', ms, share: total ? ms / total : 0 })).sort((a, b) => b.ms - a.ms);
  const days = [];
  for (let cursor = bounds.start; cursor < bounds.end;) {
    const date = new Date(cursor);
    const key = dateKey(date);
    days.push({ key, ms: byDay.get(key) || 0 });
    cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  }
  return { ...bounds, total, categories: categoriesStats, days, bySessionDay };
}

function renderStats() {
  $('#headingAction').innerHTML = '';
  const isPlan = !window.statsMode || window.statsMode === 'plan';
  window.statsMode = isPlan ? 'plan' : 'time';
  if (isPlan) renderPlanStats(); else renderTimeStats();
}

function renderPlanStats() {
  const stats = monthPlanStats(selectedMonth);
  const counts = REASONS.map(reason => ({ reason, count: stats.incomplete.filter(task => task.reason === reason).length }));
  const maxTaskCount = Math.max(1, ...Array.from({ length: stats.days }, (_, i) => state.tasks.filter(t => t.dateKey === `${selectedMonth}-${pad(i + 1)}`).length));
  const daily = Array.from({ length: stats.days }, (_, i) => {
    const key = `${selectedMonth}-${pad(i + 1)}`;
    const tasks = state.tasks.filter(task => task.dateKey === key);
    const done = tasks.filter(task => task.status === 'completed').length;
    const incomplete = tasks.filter(task => task.status === 'incomplete').length;
    const pending = tasks.length - done - incomplete;
    const denominator = done + incomplete;
    const rate = denominator ? done / denominator : 0;
    return `<div class="chart-row"><span>${Number(key.slice(-2))} 日 · ${tasks.length}</span><div class="bar"><i style="width:${Math.round(tasks.length / maxTaskCount * 100)}%;opacity:${tasks.length ? 1 : .16}"></i></div><strong>${denominator ? `${Math.round(rate * 100)}%` : '—'}</strong></div><div class="fine" style="margin:-6px 0 2px 80px">完成 ${done} · 未完成 ${incomplete} · 待复盘 ${pending}</div>`;
  }).join('');
  $('#content').innerHTML = `<div class="stats-switch"><button class="active" data-action="stats-mode" data-mode="plan">计划分析</button><button data-action="stats-mode" data-mode="time">投入分析</button></div>
    <div class="date-nav panel"><button data-action="month-shift" data-delta="-1">‹</button><div class="date-label">${Number(selectedMonth.slice(5))} 月 ${selectedMonth.slice(0, 4)}<small>计划月报</small></div><button data-action="month-shift" data-delta="1">›</button><input type="month" id="statsMonth" value="${esc(selectedMonth)}" aria-label="选择统计月份"></div>
    <div class="stats-grid" style="margin-top:16px"><article class="stats-card"><h3>本月完成率</h3><strong class="big">${Math.round(stats.rate * 100)}%</strong><div class="stat-line"><span>已完成</span><strong>${stats.completed}</strong></div><div class="stat-line"><span>未完成</span><strong>${stats.incomplete.length}</strong></div><div class="stat-line"><span>待复盘</span><strong>${stats.pending}</strong></div></article>
    <article class="stats-card"><h3>未完成理由</h3><p class="fine">按未完成任务数计算占比</p><div class="chart-list reason-bars">${counts.map(item => `<div><div class="stat-line"><span>${item.reason}</span><strong>${item.count} · ${stats.incomplete.length ? Math.round(item.count / stats.incomplete.length * 100) : 0}%</strong></div><div class="bar"><i style="width:${stats.incomplete.length ? item.count / stats.incomplete.length * 100 : 0}%"></i></div></div>`).join('')}</div></article>
    <article class="stats-card"><h3>本月任务概况</h3><strong class="big">${stats.all.length}</strong><div class="stat-line"><span>任务总数</span><strong>${stats.all.length}</strong></div><div class="stat-line"><span>复盘任务</span><strong>${stats.reviewed}</strong></div><div class="stat-line"><span>有记录的日期</span><strong>${new Set(stats.all.map(t => t.dateKey)).size}</strong></div></article></div>
    <article class="panel" style="margin-top:16px"><h2 class="section-title">每日完成趋势 <span class="fine">完成率只按已复盘任务计算</span></h2><div class="chart-list">${daily}</div></article>`;
}

function renderTimeStats() {
  const stats = timeStats(timeRange, timeAnchor);
  const rangeLabel = timeRange === 'day' ? localDateLabel(stats.startDate) : `${stats.startDate} 至 ${stats.endDate}`;
  const maxDay = Math.max(1, ...stats.days.map(day => day.ms));
  const anchorMonth = monthKey(parseDate(timeAnchor));
  $('#content').innerHTML = `<div class="stats-switch"><button data-action="stats-mode" data-mode="plan">计划分析</button><button class="active" data-action="stats-mode" data-mode="time">投入分析</button></div>
    <div class="panel"><div class="segmented">${[['day','日'],['week','周'],['month','月']].map(([value,label]) => `<button class="${timeRange === value ? 'active' : ''}" data-action="time-range" data-range="${value}">${label}</button>`).join('')}</div>
    <div class="date-nav"><button data-action="time-shift" data-delta="-1">‹</button><div class="date-label">${esc(rangeLabel)}<small>${timeRange === 'week' ? '周一至周日' : timeRange === 'month' ? `${anchorMonth.slice(0,4)} 年 ${Number(anchorMonth.slice(5))} 月` : '本地时间'}</small></div><button data-action="time-shift" data-delta="1">›</button><button class="text-button" data-action="time-today">今天</button></div>
    <div class="stats-grid" style="margin-top:16px"><article class="stats-card"><h3>投入总时长</h3><strong class="big">${esc(duration(stats.total))}</strong><p class="fine">跨日计时会按本地日期拆分</p></article><article class="stats-card" style="grid-column:span 2"><h3>各项目时长与占比</h3>${stats.categories.length ? stats.categories.map(item => `<div class="category-stat"><div class="category-stat-head"><span>${esc(item.name)}</span><strong>${esc(duration(item.ms))} · ${Math.round(item.share * 100)}%</strong></div><div class="bar"><i style="width:${Math.round(item.share * 100)}%"></i></div></div>`).join('') : '<p class="fine">这个周期还没有投入记录。</p>'}</article></div>
    <article class="panel" style="margin-top:16px"><h2 class="section-title">每日趋势与明细</h2><div class="chart-list">${stats.days.map(day => `<div class="chart-row"><span>${esc(day.key.slice(5))}</span><div class="bar"><i style="width:${Math.round(day.ms / maxDay * 100)}%"></i></div><strong>${day.ms ? esc(duration(day.ms)) : '—'}</strong></div>`).join('')}</div></article>
    <article class="panel" style="margin-top:16px"><h2 class="section-title">每日项目明细</h2>${stats.days.map(day => {
      const rows = stats.categories.map(category => ({ ...category, ms: stats.bySessionDay.get(`${day.key}|${category.categoryId}`) || 0 })).filter(row => row.ms > 0);
      return `<div class="stat-line" style="padding:9px 0;border-bottom:1px solid var(--line)"><span>${esc(day.key)}</span><strong>${day.ms ? esc(duration(day.ms)) : '—'}</strong></div>${rows.map(row => `<div class="stat-line fine" style="padding-left:14px"><span>${esc(row.name)}</span><strong>${esc(duration(row.ms))}</strong></div>`).join('')}`;
    }).join('')}</article></div>`;
}

function renderData() {
  $('#headingAction').innerHTML = '';
  const size = new Blob([JSON.stringify(state)]).size;
  const installed = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const offlineStatus = window.__DAYMARK_OFFLINE_READY__ ? '离线资源已缓存' : location.protocol === 'https:' ? '首次打开后正在缓存，请保持页面打开片刻' : '需通过 HTTPS 地址首次打开后才能安装并启用离线缓存';
  $('#content').innerHTML = `<section class="panel"><h2 class="section-title">本机数据</h2><p class="data-note">计划任务、复盘和计时记录保存在当前 iPad 的 Safari 网站数据中。清除 Safari 网站数据、删除主屏幕网页应用或更换设备可能导致数据丢失，请定期导出备份。</p><div class="stats-grid"><article class="stats-card"><h3>任务</h3><strong class="big">${state.tasks.length}</strong></article><article class="stats-card"><h3>投入记录</h3><strong class="big">${state.sessions.length}</strong></article><article class="stats-card"><h3>本地数据大小</h3><strong class="big">${size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`}</strong></article></div><div class="data-actions" style="margin-top:18px"><button class="button button-primary" data-action="export">导出 JSON 备份</button><button class="button button-quiet" data-action="import">从 JSON 导入</button></div><p class="data-note" style="margin-top:20px"><strong>跨设备迁移：</strong>在 HarmonyOS 版导出数据文件，再通过“文件”或 iCloud Drive 传到 iPad 后导入。导入会替换 iPad 当前全部数据，建议先导出一份备份。两端数据不会自动同步。</p></section><section class="panel" style="margin-top:16px"><h2 class="section-title">晚间提醒</h2><p class="data-note">每天 21:30 后，只要你打开本应用且当天尚未复盘，页面就会显示待复盘提醒。iPad 网页应用不能可靠地安排应用关闭后的本地定时通知。</p></section>`;
  $('#content').insertAdjacentHTML('afterbegin', `<section class="panel" style="margin-bottom:16px"><h2 class="section-title">iPad 网页应用</h2><div class="stat-line"><span>打开方式</span><strong>${installed ? '已添加到主屏幕' : 'Safari 浏览器'}</strong></div><div class="stat-line"><span>离线状态</span><strong>${offlineStatus}</strong></div><p class="data-note">首次请用 iPad Safari 打开 HTTPS 安装网址，点“分享”→“添加到主屏幕”。资源缓存完成后可断网使用，计划数据保存在 iPad 本机。</p></section>`);
}

function openTaskDialog(task) {
  editingTaskId = task?.id || '';
  $('#taskDialogTitle').textContent = task ? '编辑任务' : '安排一件事';
  $('#taskTitle').value = task?.title || '';
  $('#taskStart').value = task?.startTime || '';
  $('#taskEnd').value = task?.endTime || '';
  $('#taskConflict').classList.add('hidden');
  $('#taskDialog').showModal();
  setTimeout(() => $('#taskTitle').focus(), 50);
}

function saveTask(event) {
  event.preventDefault();
  const title = $('#taskTitle').value.trim();
  const startTime = $('#taskStart').value;
  const endTime = $('#taskEnd').value;
  if (!title) { toast('请填写任务名称。'); return; }
  if (!!startTime !== !!endTime) { toast('开始和结束时间需要同时填写，或同时留空。'); return; }
  if (startTime && endTime <= startTime) { toast('结束时间需要晚于开始时间。'); return; }
  const conflict = startTime && state.tasks.some(task => task.dateKey === selectedDate && task.id !== editingTaskId && task.startTime && startTime < task.endTime && endTime > task.startTime);
  if (conflict && !window.confirm('这个时间段与已有任务重叠，仍要保存吗？')) return;
  if (editingTaskId) {
    const task = state.tasks.find(item => item.id === editingTaskId);
    if (task) Object.assign(task, { title, startTime, endTime });
  } else state.tasks.push({ id: id(), dateKey: selectedDate, title, startTime, endTime, status: 'unreviewed', reason: null, createdAt: Date.now() });
  persist();
  $('#taskDialog').close();
  render();
  toast(editingTaskId ? '任务已更新。' : '任务已添加。');
}

function beginReview() {
  const tasks = tasksForDate(selectedDate);
  if (!tasks.length) { toast('今天还没有计划任务。'); return; }
  reviewDraft = {};
  reviewReasons = {};
  reviewing = true;
  render();
}
function submitReview() {
  const tasks = tasksForDate(selectedDate);
  for (const task of tasks) {
    const status = taskState(task);
    if (status === 'unreviewed' || (status === 'incomplete' && !taskReason(task))) { toast('请完成每项任务的复盘，并为未完成任务选择理由。'); return; }
  }
  for (const task of tasks) {
    task.status = taskState(task);
    task.reason = task.status === 'incomplete' ? taskReason(task) : null;
  }
  if (!state.reviewedDateKeys.includes(selectedDate)) state.reviewedDateKeys.push(selectedDate);
  reviewing = false;
  reviewDraft = {};
  reviewReasons = {};
  persist();
  render();
  toast('今天的复盘已保存。');
}

function startOrStopCategory(categoryId) {
  const now = Date.now();
  const current = activeSession();
  if (current?.categoryId === categoryId) current.endedAt = now;
  else {
    if (current) current.endedAt = now;
    const category = state.categories.find(item => item.id === categoryId);
    if (!category?.active) return;
    state.sessions.push({ id: id(), categoryId, categoryNameSnapshot: category.name, startedAt: now, endedAt: null });
  }
  persist();
  render();
  toast(current?.categoryId === categoryId ? '计时已结束。' : '已开始计时。');
}

function openCategoryDialog(category) {
  editingCategoryId = category?.id || '';
  $('#categoryDialogTitle').textContent = category ? '编辑投入项目' : '新建投入项目';
  $('#categoryName').value = category?.name || '';
  $('#categoryDialog').showModal();
  setTimeout(() => $('#categoryName').focus(), 50);
}
function saveCategory(event) {
  event.preventDefault();
  const name = $('#categoryName').value.trim();
  if (!name) { toast('请填写投入项目名称。'); return; }
  if (editingCategoryId) {
    const item = state.categories.find(category => category.id === editingCategoryId);
    if (item) {
      item.name = name;
      const running = activeSession();
      if (running?.categoryId === item.id) running.categoryNameSnapshot = name;
    }
  } else state.categories.push({ id: id(), name, active: true, createdAt: Date.now() });
  persist();
  $('#categoryDialog').close();
  render();
  toast(editingCategoryId ? '项目名称已更新。' : '投入项目已创建。');
}

function exportState() {
  const backup = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
  const nativeHandler = window.webkit?.messageHandlers?.daymarkExport;
  if (nativeHandler) { nativeHandler.postMessage(backup); return; }
  const blob = new Blob([backup], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `daymark-backup-${dateKey(new Date())}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('JSON 备份已导出。');
}

function validImport(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.categories) || !Array.isArray(value.sessions) || !Array.isArray(value.reviewedDateKeys)) return false;
  const keyOk = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
  if (!value.tasks.every(task => task && typeof task.id === 'string' && keyOk(task.dateKey) && typeof task.title === 'string' && ['unreviewed','completed','incomplete'].includes(task.status) && (task.reason === null || task.reason === undefined || REASONS.includes(task.reason)))) return false;
  if (!value.categories.every(category => category && typeof category.id === 'string' && typeof category.name === 'string' && typeof category.active === 'boolean')) return false;
  if (!value.sessions.every(session => session && typeof session.id === 'string' && typeof session.categoryId === 'string' && Number.isFinite(session.startedAt) && (session.endedAt === null || Number.isFinite(session.endedAt)))) return false;
  return value.reviewedDateKeys.every(keyOk);
}

window.__DAYMARK_IMPORT__ = jsonText => {
  try {
    const value = JSON.parse(jsonText);
    if (!validImport(value)) throw new Error('invalid');
    if (!window.confirm(`将导入 ${value.tasks.length} 项任务和 ${value.sessions.length} 条计时记录，并替换本机当前数据。继续吗？`)) return false;
    state = { schemaVersion: 1, tasks: value.tasks, categories: value.categories, sessions: value.sessions, reviewedDateKeys: value.reviewedDateKeys };
    window.__DAYMARK_NATIVE_STATE__ = state;
    persist(); render(); toast('数据已导入。');
    return true;
  } catch (_) { toast('文件格式不正确或版本不兼容。'); return false; }
};

$('#taskForm').addEventListener('submit', saveTask);
$('#categoryForm').addEventListener('submit', saveCategory);
$('.tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  tab = button.dataset.tab;
  reviewing = false;
  render();
});
$('#headingAction').addEventListener('click', event => {
  const button = event.target.closest('[data-action="add-task"], [data-action="add-category"]');
  if (!button) return;
  if (button.dataset.action === 'add-task') openTaskDialog();
  else openCategoryDialog();
});
$('#reviewNow').addEventListener('click', () => { selectedDate = dateKey(new Date()); tab = 'plan'; beginReview(); });
$('#importFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    if (!validImport(value)) throw new Error('invalid');
    if (!window.confirm(`将导入 ${value.tasks.length} 项任务和 ${value.sessions.length} 条计时记录，并替换本机当前数据。继续吗？`)) return;
    state = { schemaVersion: 1, tasks: value.tasks, categories: value.categories, sessions: value.sessions, reviewedDateKeys: value.reviewedDateKeys };
    persist(); render(); toast('数据已导入。');
  } catch (_) { toast('文件格式不正确或版本不兼容。'); }
  finally { event.target.value = ''; }
});

$('#content').addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'planDate' && target.value) { selectedDate = target.value; reviewing = false; render(); }
  if (target.id === 'statsMonth' && target.value) { selectedMonth = target.value; render(); }
  if (target.matches('[data-action="review-status"]')) {
    reviewDraft[target.dataset.id] = target.value;
    if (target.value === 'completed') delete reviewReasons[target.dataset.id];
    render();
  }
});

$('#content').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const itemId = button.dataset.id;
  if (action === 'add-task') openTaskDialog();
  else if (action === 'edit-task') { const task = state.tasks.find(item => item.id === itemId); if (task) openTaskDialog(task); }
  else if (action === 'delete-task') { if (window.confirm('删除这项计划？删除后无法恢复。')) { state.tasks = state.tasks.filter(task => task.id !== itemId); persist(); render(); toast('任务已删除。'); } }
  else if (action === 'shift-day') { selectedDate = shiftDate(selectedDate, Number(button.dataset.delta)); reviewing = false; render(); }
  else if (action === 'today') { selectedDate = dateKey(new Date()); reviewing = false; render(); }
  else if (action === 'begin-review') beginReview();
  else if (action === 'cancel-review') { reviewing = false; render(); }
  else if (action === 'submit-review') submitReview();
  else if (action === 'reason') { reviewReasons[itemId] = button.dataset.reason; render(); }
  else if (action === 'add-category') openCategoryDialog();
  else if (action === 'edit-category') { const category = state.categories.find(item => item.id === itemId); if (category) openCategoryDialog(category); }
  else if (action === 'toggle-category') startOrStopCategory(itemId);
  else if (action === 'deactivate-category') { const category = state.categories.find(item => item.id === itemId); if (!category) return; if (!window.confirm(`停用“${category.name}”？历史记录会保留。`)) return; category.active = false; const current = activeSession(); if (current?.categoryId === itemId) current.endedAt = Date.now(); persist(); render(); }
  else if (action === 'activate-category') { const category = state.categories.find(item => item.id === itemId); if (category) { category.active = true; persist(); render(); } }
  else if (action === 'stats-mode') { window.statsMode = button.dataset.mode; render(); }
  else if (action === 'month-shift') { selectedMonth = shiftMonth(selectedMonth, Number(button.dataset.delta)); render(); }
  else if (action === 'time-range') { timeRange = button.dataset.range; timeAnchor = dateKey(new Date()); render(); }
  else if (action === 'time-shift') {
    if (timeRange === 'month') timeAnchor = `${shiftMonth(monthKey(parseDate(timeAnchor)), Number(button.dataset.delta))}-01`;
    else timeAnchor = shiftDate(timeAnchor, Number(button.dataset.delta) * (timeRange === 'week' ? 7 : 1));
    render();
  }
  else if (action === 'time-today') { timeAnchor = dateKey(new Date()); render(); }
  else if (action === 'export') exportState();
  else if (action === 'import') {
    const nativeHandler = window.webkit?.messageHandlers?.daymarkImport;
    if (nativeHandler) nativeHandler.postMessage('');
    else $('#importFile').click();
  }
});

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      window.__DAYMARK_OFFLINE_READY__ = true;
      if (tab === 'data') renderData();
    })
    .catch(() => {}));
}

render();
setInterval(() => {
  if (tab === 'focus' && activeSession()) render();
  else if (isReviewDue() !== !$('#reminder').classList.contains('hidden')) render();
}, 30000);
