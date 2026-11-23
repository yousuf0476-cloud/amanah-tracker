const STORAGE_KEY = "amanah_internal_tickets_v1";

const demoTickets = [
  {
    id: 101,
    title: "صيانة جهاز مسح ضوئي",
    department: "الشؤون الإدارية",
    priority: "متوسطة",
    status: "قيد المعالجة",
    description: "توقف الماسح الضوئي في مكتب الاستقبال بالدور الأول.",
    date: "2026-11-20"
  },
  {
    id: 102,
    title: "انقطاع نقطة شبكة في قاعة الاجتماعات",
    department: "تقنية المعلومات",
    priority: "عالية",
    status: "جديد",
    description: "عدم توفر اتصال سلكي في القاعة الرئيسية.",
    date: "2026-11-22"
  },
  {
    id: 103,
    title: "استبدال وحدة إضاءة بالممر",
    department: "الخدمات والصيانة",
    priority: "منخفضة",
    status: "منجز",
    description: "تم استبدال الإضاءة والتأكد من عملها.",
    date: "2026-11-18"
  }
];

let tickets = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [...demoTickets];

const form = document.getElementById("ticketForm");
const ticketsBody = document.getElementById("ticketsBody");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const resetDemoBtn = document.getElementById("resetDemoBtn");

// يمنع تنفيذ أي كود يكتبه المستخدم داخل نص البلاغ (حماية من XSS)
function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function saveTickets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
}

function updateStats() {
  document.getElementById("totalCount").textContent = tickets.length;
  document.getElementById("newCount").textContent = tickets.filter(t => t.status === "جديد").length;
  document.getElementById("progressCount").textContent = tickets.filter(t => t.status === "قيد المعالجة").length;
  document.getElementById("doneCount").textContent = tickets.filter(t => t.status === "منجز").length;
}

function getStatusClass(status) {
  if (status === "جديد") return "status-جديد";
  if (status === "قيد المعالجة") return "status-قيد";
  return "status-منجز";
}

function renderTickets() {
  const query = searchInput.value.trim().toLowerCase();
  const statusVal = statusFilter.value;

  const filtered = tickets.filter(ticket => {
    const matchesQuery =
      ticket.title.toLowerCase().includes(query) ||
      ticket.department.toLowerCase().includes(query) ||
      ticket.description.toLowerCase().includes(query);
    const matchesStatus = statusVal === "الكل" || ticket.status === statusVal;
    return matchesQuery && matchesStatus;
  });

  ticketsBody.innerHTML = filtered.map(ticket => `
    <tr>
      <td>#${ticket.id}</td>
      <td>
        <strong>${escapeHTML(ticket.title)}</strong><br/>
        <small style="color:#64748b">${escapeHTML(ticket.description)}</small>
      </td>
      <td>${escapeHTML(ticket.department)}</td>
      <td><span class="priority-${ticket.priority}">${escapeHTML(ticket.priority)}</span></td>
      <td><span class="badge ${getStatusClass(ticket.status)}">${escapeHTML(ticket.status)}</span></td>
      <td>${ticket.date}</td>
      <td>
        <button class="action-btn" onclick="cycleStatus(${ticket.id})">تحديث الحالة</button>
        <button class="action-btn delete" onclick="deleteTicket(${ticket.id})">حذف</button>
      </td>
    </tr>
  `).join("");

  updateStats();
}

window.cycleStatus = function(id) {
  const order = ["جديد", "قيد المعالجة", "منجز"];
  tickets = tickets.map(t => {
    if (t.id === id) {
      const nextIndex = (order.indexOf(t.status) + 1) % order.length;
      return { ...t, status: order[nextIndex] };
    }
    return t;
  });
  saveTickets();
  renderTickets();
};

window.deleteTicket = function(id) {
  tickets = tickets.filter(t => t.id !== id);
  saveTickets();
  renderTickets();
};

form.addEventListener("submit", e => {
  e.preventDefault();
  const nextId = tickets.length ? Math.max(...tickets.map(t => t.id)) + 1 : 101;
  const newTicket = {
    id: nextId,
    title: document.getElementById("title").value.trim(),
    department: document.getElementById("department").value,
    priority: document.getElementById("priority").value,
    status: "جديد",
    description: document.getElementById("description").value.trim(),
    date: new Date().toISOString().split("T")[0]
  };
  tickets.unshift(newTicket);
  saveTickets();
  renderTickets();
  form.reset();
});

searchInput.addEventListener("input", renderTickets);
statusFilter.addEventListener("change", renderTickets);

resetDemoBtn.addEventListener("click", () => {
  tickets = [...demoTickets];
  saveTickets();
  renderTickets();
});

renderTickets();
