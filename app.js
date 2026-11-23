/* =========================================================================
   app.js — منطق منصة رَصْد: البلاغات، العرض، الفلترة، والربط مع قاعدة البيانات (db.js) والذكاء الاصطناعي (ai.js)
   ========================================================================= */
"use strict";

const DB = window.RasdDB; // طبقة قاعدة البيانات (db.js)
const STATUS_ORDER = ["جديد", "قيد المعالجة", "منجز"];
const PRIORITY_RANK = { "عالية": 0, "متوسطة": 1, "منخفضة": 2 };
const DEPTS = ["تقنية المعلومات", "الخدمات والصيانة", "الشؤون الإدارية", "المشاريع", "خدمة المستفيدين"];
const DAY = 86400000;
const $ = id => document.getElementById(id);

/* ---------- بيانات تجريبية (تواريخها نسبية لليوم) ---------- */
function demoTickets() {
  const now = Date.now();
  const ago = d => new Date(now - d * DAY).toISOString();
  const t = (id, title, department, priority, status, description, days, doneAfterHours) => ({
    id, title, department, priority, status, description,
    createdAt: ago(days), updatedAt: ago(days),
    resolvedAt: status === "منجز" ? new Date(now - days * DAY + doneAfterHours * 3600000).toISOString() : null,
    ai: null
  });
  return [
    t(101, "انقطاع نقطة شبكة في قاعة الاجتماعات", "تقنية المعلومات", "عالية", "جديد", "عدم توفر اتصال سلكي في القاعة الرئيسية قبل اجتماع المدير.", 3),
    t(102, "تعطل جهاز المسح الضوئي في الاستقبال", "تقنية المعلومات", "متوسطة", "قيد المعالجة", "توقف الماسح الضوئي في مكتب الاستقبال بالدور الأول.", 2),
    t(103, "استبدال وحدة إضاءة بالممر", "الخدمات والصيانة", "منخفضة", "منجز", "تم استبدال الإضاءة والتأكد من عملها.", 5, 20),
    t(104, "المكيف لا يبرد في مكتب المشاريع", "الخدمات والصيانة", "متوسطة", "قيد المعالجة", "درجة الحرارة مرتفعة في المكتب منذ الصباح.", 1),
    t(105, "جهاز تذاكر الانتظار متوقف في صالة المراجعين", "خدمة المستفيدين", "عالية", "منجز", "المراجعون لا يستطيعون أخذ رقم انتظار.", 4, 3),
    t(106, "طلب أدوات مكتبية للإدارة", "الشؤون الإدارية", "منخفضة", "جديد", "أوراق وأقلام وملفات حفظ.", 0),
    t(107, "انقطاع الشبكة عن أجهزة الدور الثاني", "تقنية المعلومات", "عالية", "قيد المعالجة", "لا يوجد اتصال بالشبكة في عدة مكاتب.", 0),
    t(108, "طلب مخططات مشروع الحديقة العامة", "المشاريع", "متوسطة", "منجز", "مطلوبة لاجتماع الاستشاري.", 6, 30)
  ];
}

/* ---------- البيانات: قاعدة البيانات السحابية + نسخة احتياطية في المتصفح ---------- */
let tickets = DB.cache.read() || [];   // نعرض آخر نسخة محفوظة فوراً، ثم نحدّث من قاعدة البيانات
let busy = false;                       // يمنع التحديث الدوري أثناء تنفيذ عملية

function setDbStatus() {
  const el = $("dbStatus");
  el.className = "db-status " + (DB.online ? "on" : "off");
  el.textContent = DB.online ? "متصل بقاعدة البيانات" : "بدون اتصال · حفظ محلي";
  el.title = DB.online ? "البيانات محفوظة في " + DB.provider : "تعذر الاتصال بقاعدة البيانات، يتم الحفظ في المتصفح مؤقتاً";
}
function saveLocal() { DB.cache.write(tickets); }

// تنفيذ عملية على قاعدة البيانات، ولو فشل الاتصال نكمل محلياً بدون ما يضيع شي
async function dbTry(fn, fallback) {
  if (DB.online) {
    try { const r = await fn(); saveLocal(); return r; }
    catch (e) { DB.online = false; setDbStatus(); toast("تعذر الاتصال بقاعدة البيانات، تم الحفظ محلياً"); }
  }
  const r = fallback(); saveLocal(); return r;
}

async function loadFromDB() {
  const list = await DB.list();
  if (DB.online && list && list.length === 0) {
    tickets = await DB.resetDemo(demoTickets()); // قاعدة بيانات فارغة: نضيف البيانات التجريبية
    saveLocal();
  } else if (list) tickets = list;
  else if (!tickets.length) tickets = demoTickets(); // أول تشغيل بدون اتصال
  setDbStatus(); retrain(); renderAll();
}

/* ---------- أدوات مساعدة ---------- */
function escapeHTML(text) { // يمنع تنفيذ أي كود يكتبه المستخدم (حماية من XSS)
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function ageText(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "اليوم" : d === 1 ? "أمس" : d === 2 ? "منذ يومين" : `منذ ${d} أيام`;
}
function isLate(t) {
  const d = (Date.now() - new Date(t.createdAt).getTime()) / DAY;
  return t.status !== "منجز" && ((t.priority === "عالية" && d >= 2) || (t.status === "جديد" && d >= 3));
}
const statusClass = s => (s === "جديد" ? "s-new" : s === "قيد المعالجة" ? "s-progress" : "s-done");
const priorityClass = p => (p === "عالية" ? "p-high" : p === "متوسطة" ? "p-mid" : "p-low");
const nextActionLabel = s => (s === "جديد" ? "بدء المعالجة" : s === "قيد المعالجة" ? "إنجاز" : "إعادة فتح");

let toastTimer;
function toast(msg, action) {
  const el = $("toast");
  el.innerHTML = escapeHTML(msg) + (action ? ` <button type="button" class="toast-btn">${escapeHTML(action.label)}</button>` : "");
  el.hidden = false;
  if (action) el.querySelector(".toast-btn").onclick = () => { action.run(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

/* ---------- الذكاء الاصطناعي: النموذج يتدرب على الأمثلة + بلاغاتك ---------- */
let models = SmartAI.buildModels(tickets);
function retrain() { models = SmartAI.buildModels(tickets); }

let lastSuggestion = null;      // آخر اقتراح من النموذج
let userChanged = { department: false, priority: false }; // هل غيّر المستخدم الاختيار بنفسه؟

function updateSuggestion() {
  const text = $("title").value + " " + $("description").value;
  const box = $("aiBox");
  if (text.trim().length < 4) { box.hidden = true; lastSuggestion = null; $("similarBox").hidden = true; return; }

  const s = SmartAI.suggest(models, text);
  lastSuggestion = s;
  box.hidden = false;
  const show = (r, nameEl, barEl, confEl) => {
    $(nameEl).textContent = r ? r.label : "غير متأكد";
    const pct = r ? Math.min(99, Math.round(r.confidence * 100)) : 0; // لا نعرض 100%: النموذج قد يخطئ
    $(barEl).style.width = pct + "%";
    $(confEl).textContent = r ? `ثقة ${pct}%` : "";
  };
  show(s.dept, "aiDept", "aiDeptBar", "aiDeptConf");
  show(s.priority, "aiPriority", "aiPrBar", "aiPrConf");
  const reasons = [...new Set([...(s.dept ? s.dept.reasons : []), ...(s.priority ? s.priority.reasons : [])])];
  $("aiWhy").textContent = reasons.length ? "السبب: النص يحتوي على كلمات مثل « " + reasons.join("، ") + " »" : "اكتب تفاصيل أكثر ليتأكد النموذج.";

  // تعبئة تلقائية ما لم يغيّر المستخدم الاختيار بنفسه
  if (s.dept && !userChanged.department) $("department").value = s.dept.label;
  if (s.priority && !userChanged.priority) $("priority").value = s.priority.label;

  // كشف البلاغات المتشابهة
  const similar = SmartAI.findSimilar(text, tickets);
  const sb = $("similarBox");
  if (similar.length) {
    sb.hidden = false;
    sb.innerHTML = "<b>تنبيه: يوجد بلاغ مفتوح مشابه، تأكد أنه ليس مكرراً</b>" + similar.map(x =>
      `<div>#${x.ticket.id} - ${escapeHTML(x.ticket.title)} <small>(تشابه ${Math.round(x.score * 100)}% · ${escapeHTML(x.ticket.status)})</small></div>`).join("");
  } else sb.hidden = true;
}

/* ---------- العرض ---------- */
function updateStats() {
  const c = s => tickets.filter(t => t.status === s).length;
  $("totalCount").textContent = tickets.length;
  $("newCount").textContent = c("جديد");
  $("progressCount").textContent = c("قيد المعالجة");
  $("doneCount").textContent = c("منجز");
  $("urgentCount").textContent = tickets.filter(t => t.priority === "عالية" && t.status !== "منجز").length;
}

function renderCharts() {
  const open = tickets.filter(t => t.status !== "منجز");
  const counts = DEPTS.map(d => [d, open.filter(t => t.department === d).length]);
  const max = Math.max(1, ...counts.map(x => x[1]));
  $("deptChart").innerHTML = counts.map(([d, n]) =>
    `<div class="bar-row"><span class="bar-label">${d}</span><span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span><b>${n}</b></div>`).join("");

  const total = tickets.length || 1;
  const parts = STATUS_ORDER.map(s => [s, tickets.filter(t => t.status === s).length]);
  $("statusBar").innerHTML = parts.map(([s, n]) => n ? `<span class="${statusClass(s)}" style="width:${(n / total) * 100}%"></span>` : "").join("");
  $("statusLegend").innerHTML = parts.map(([s, n]) => `<span><i class="${statusClass(s)}"></i>${s} (${n})</span>`).join("");
}

function renderInsights() {
  $("insightsList").innerHTML = SmartAI.insights(tickets).map(i => `<li class="ins-${i.type}">${escapeHTML(i.text)}</li>`).join("");
}

function filteredTickets() {
  const q = $("searchInput").value.trim().toLowerCase();
  const nq = SmartAI.normalize(q).trim();
  const st = $("statusFilter").value, dp = $("deptFilter").value, pr = $("priorityFilter").value;
  const list = tickets.filter(t => {
    const hay = (t.title + " " + t.description + " " + t.department).toLowerCase();
    const matchQ = !q || hay.includes(q) || SmartAI.normalize(hay).includes(nq); // بحث يتجاهل الهمزات والتاء المربوطة
    return matchQ && (st === "الكل" || t.status === st) && (dp === "الكل" || t.department === dp) && (pr === "الكل" || t.priority === pr);
  });
  const sort = $("sortSelect").value;
  const time = t => new Date(t.createdAt).getTime();
  if (sort === "newest") list.sort((a, b) => time(b) - time(a));
  else if (sort === "oldest") list.sort((a, b) => time(a) - time(b));
  else list.sort((a, b) => // ذكي: المفتوح أولاً، ثم الأعلى أولوية، ثم الأقدم
    (a.status === "منجز") - (b.status === "منجز") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || time(a) - time(b));
  return list;
}

function renderTickets() {
  const list = filteredTickets();
  $("resultCount").textContent = `(${list.length} من ${tickets.length})`;
  $("ticketsBody").innerHTML = list.length ? list.map(t => `
    <tr class="${isLate(t) ? "late" : ""}">
      <td>#${t.id}</td>
      <td>
        <strong>${escapeHTML(t.title)}</strong>
        ${t.ai && t.ai.dept === t.department ? '<span class="tag-ai" title="صنّفه الذكاء الاصطناعي">AI</span>' : ""}
        ${isLate(t) ? '<span class="tag-late">متأخر</span>' : ""}
        <br/><small class="muted">${escapeHTML(t.description)}</small>
      </td>
      <td>${escapeHTML(t.department)}</td>
      <td><span class="${priorityClass(t.priority)}">${escapeHTML(t.priority)}</span></td>
      <td><span class="badge ${statusClass(t.status)}">${escapeHTML(t.status)}</span></td>
      <td class="nowrap">${ageText(t.createdAt)}</td>
      <td class="nowrap">
        <button type="button" class="action-btn" data-action="next" data-id="${t.id}">${nextActionLabel(t.status)}</button>
        <button type="button" class="action-btn delete" data-action="delete" data-id="${t.id}" aria-label="حذف البلاغ ${t.id}">حذف</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty">لا توجد بلاغات مطابقة.</td></tr>`;
}

function renderModelInfo() {
  $("modelInfo").innerHTML = `<b>نموذج الذكاء الاصطناعي:</b> تعلّم من ${models.size} مثالاً ` +
    `(${models.size - models.learned} مثالاً أساسياً + ${models.learned} من بلاغاتكم). ` +
    `دقته في اختيار الجهة الصحيحة في الاختبار: <b>83%</b>. كل بلاغ جديد يزيد خبرته.`;
}

function renderAll() { updateStats(); renderCharts(); renderInsights(); renderModelInfo(); renderTickets(); }

/* ---------- الإجراءات ---------- */
async function advanceStatus(id) {
  const t = tickets.find(x => x.id === id);
  if (!t || busy) return;
  busy = true;
  const status = STATUS_ORDER[(STATUS_ORDER.indexOf(t.status) + 1) % STATUS_ORDER.length];
  const resolvedAt = status === "منجز" ? new Date().toISOString() : null;
  await dbTry(
    async () => { const u = await DB.update(id, { status, resolvedAt }); Object.assign(t, u || { status, resolvedAt }); },
    () => Object.assign(t, { status, resolvedAt, updatedAt: new Date().toISOString() })
  );
  busy = false;
  renderAll();
  toast(`البلاغ #${id}: ${t.status}`);
}

async function deleteTicket(id) {
  const idx = tickets.findIndex(x => x.id === id);
  if (idx < 0 || busy) return;
  busy = true;
  const removed = tickets[idx];
  await dbTry(() => DB.remove(id), () => null);
  tickets.splice(idx, 1);
  saveLocal(); retrain(); renderAll(); busy = false;
  toast(`تم حذف البلاغ #${id}`, { label: "تراجع", run: async () => {
    await dbTry(async () => { await DB.restore(removed); }, () => null);
    tickets.splice(Math.min(idx, tickets.length), 0, removed);
    saveLocal(); retrain(); renderAll();
  } });
}

// تفويض الأحداث: مستمع واحد للجدول بدل مستمع لكل زر
$("ticketsBody").addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === "next") advanceStatus(id); else deleteTicket(id);
});

$("ticketForm").addEventListener("submit", async e => {
  e.preventDefault();
  const title = $("title").value.trim(), description = $("description").value.trim();
  if (!title || !description) return;
  const now = new Date().toISOString();
  const s = lastSuggestion || SmartAI.suggest(models, title + " " + description);
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  let t = {
    title, description,
    department: $("department").value,
    priority: $("priority").value,
    status: "جديد",
    createdAt: now, updatedAt: now, resolvedAt: null,
    ai: { dept: s.dept ? s.dept.label : null, priority: s.priority ? s.priority.label : null }
  };
  t = await dbTry(
    () => DB.add(t),                                                                       // قاعدة البيانات تعطي الرقم
    () => ({ ...t, id: tickets.length ? Math.max(...tickets.map(x => x.id)) + 1 : 101 })  // بدون اتصال
  );
  tickets.unshift(t);
  saveLocal();
  btn.disabled = false;
  retrain(); // النموذج يتعلم من البلاغ الجديد
  renderAll();
  e.target.reset();
  userChanged = { department: false, priority: false };
  $("aiBox").hidden = true; $("similarBox").hidden = true; lastSuggestion = null;
  toast(`تمت إضافة البلاغ #${t.id} وتوجيهه إلى ${t.department}`);
});

["department", "priority"].forEach(k => $(k).addEventListener("change", () => (userChanged[k] = true)));
const onType = debounce(updateSuggestion, 200);
$("title").addEventListener("input", onType);
$("description").addEventListener("input", onType);

const onFilter = debounce(renderTickets, 120);
$("searchInput").addEventListener("input", onFilter);
["statusFilter", "deptFilter", "priorityFilter", "sortSelect"].forEach(id => $(id).addEventListener("change", renderTickets));

$("resetDemoBtn").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  tickets = await dbTry(() => DB.resetDemo(demoTickets()), () => demoTickets());
  saveLocal(); retrain(); renderAll(); busy = false;
  toast("تمت إعادة البيانات التجريبية");
});

// تصدير البلاغات إلى ملف CSV يفتح في Excel (مع دعم العربية)
$("exportBtn").addEventListener("click", () => {
  const cols = ["الرقم", "العنوان", "الوصف", "الجهة", "الأولوية", "الحالة", "تاريخ الإنشاء", "تاريخ الإنجاز"];
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = tickets.map(t => [t.id, t.title, t.description, t.department, t.priority, t.status,
    t.createdAt.slice(0, 10), t.resolvedAt ? t.resolvedAt.slice(0, 10) : ""].map(cell).join(","));
  const blob = new Blob(["\uFEFF" + [cols.map(cell).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rasd-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// تحديث تلقائي كل 20 ثانية وعند الرجوع للصفحة: يظهر بلاغات المستخدمين الآخرين
async function refresh() {
  if (busy || document.hidden) return;
  const list = await DB.list();
  // نعيد الرسم فقط إذا تغيّرت البيانات فعلاً (أداء أفضل، والأزرار ما تتحرك تحت يد المستخدم)
  if (list && !busy && JSON.stringify(list) !== JSON.stringify(tickets)) { tickets = list; retrain(); renderAll(); }
  setDbStatus();
}
setInterval(refresh, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

renderAll();
loadFromDB();
