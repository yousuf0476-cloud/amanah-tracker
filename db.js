/* =========================================================================
   db.js — طبقة قاعدة البيانات في رَصْد
   تتصل بقاعدة PostgreSQL سحابية على Supabase عن طريق واجهة REST (بدون مكتبات).
   إذا انقطع الاتصال، يعمل النظام بوضع "بدون اتصال" ويحفظ مؤقتاً في المتصفح (LocalStorage).
   ملاحظة: المفتاح المستخدم هنا هو المفتاح العام (publishable) المخصص للمتصفح، والحماية
   تتم داخل قاعدة البيانات عن طريق Row Level Security.
   ========================================================================= */
(function (global) {
  "use strict";

  const SUPABASE_URL = "https://rfmofboioyssconixidi.supabase.co";
  const SUPABASE_KEY = "sb_publishable_WNOtlGIQODP0FB2qvGxpGw_Yh8QW45S";
  const REST = SUPABASE_URL + "/rest/v1";
  const CACHE_KEY = "rasd_tickets_cache_v3";
  const TIMEOUT_MS = 8000;

  // تحويل الأسماء بين قاعدة البيانات (snake_case) والتطبيق (camelCase)
  function fromRow(r) {
    return {
      id: r.id, title: r.title, description: r.description, department: r.department,
      priority: r.priority, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
      resolvedAt: r.resolved_at, ai: r.ai_dept || r.ai_priority ? { dept: r.ai_dept, priority: r.ai_priority } : null
    };
  }
  function toRow(t, withId) {
    const row = {
      title: t.title, description: t.description, department: t.department, priority: t.priority,
      status: t.status, created_at: t.createdAt, resolved_at: t.resolvedAt || null,
      ai_dept: t.ai ? t.ai.dept : null, ai_priority: t.ai ? t.ai.priority : null
    };
    if (withId) row.id = t.id;
    return row;
  }

  async function request(path, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(REST + path, {
        ...options,
        signal: ctrl.signal,
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=representation", ...(options.headers || {}) }
      });
      if (!res.ok) throw new Error("DB " + res.status + ": " + (await res.text()));
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  const cache = {
    read() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch (e) { return null; } },
    write(list) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) { /* ممتلئ */ } }
  };

  const DB = {
    online: false,
    provider: "Supabase (PostgreSQL)",

    // جلب كل البلاغات (الأحدث أولاً)
    async list() {
      try {
        const rows = await request("/tickets?select=*&order=id.desc");
        this.online = true;
        const list = rows.map(fromRow);
        cache.write(list);
        return list;
      } catch (e) {
        this.online = false;
        return cache.read();
      }
    },

    // إضافة بلاغ: قاعدة البيانات تعطيه الرقم التسلسلي
    async add(t) {
      const rows = await request("/tickets", { method: "POST", body: JSON.stringify(toRow(t, false)) });
      return fromRow(rows[0]);
    },

    // تحديث حقول بلاغ (مثل الحالة)
    async update(id, patch) {
      const body = {};
      if ("status" in patch) body.status = patch.status;
      if ("resolvedAt" in patch) body.resolved_at = patch.resolvedAt;
      const rows = await request("/tickets?id=eq." + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(body) });
      return rows && rows[0] ? fromRow(rows[0]) : null;
    },

    async remove(id) {
      await request("/tickets?id=eq." + encodeURIComponent(id), { method: "DELETE" });
    },

    // إعادة بلاغ محذوف بنفس رقمه (زر التراجع)
    async restore(t) {
      const rows = await request("/tickets", { method: "POST", body: JSON.stringify(toRow(t, true)) });
      return fromRow(rows[0]);
    },

    // تفريغ الجدول وإدخال البيانات التجريبية من جديد
    async resetDemo(list) {
      await request("/rpc/reset_tickets", { method: "POST", body: "{}" });
      const rows = await request("/tickets", { method: "POST", body: JSON.stringify(list.map(t => toRow(t, false))) });
      return rows.map(fromRow).sort((a, b) => b.id - a.id);
    },

    cache
  };

  global.RasdDB = DB;
})(window);
