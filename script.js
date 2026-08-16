const LEGACY_STORAGE_KEY = "casamento-leonardo-bruna-contas";
const LOCAL_CACHE_KEY = "casamento-contas-v2-cache";
const API_URL = "/api/data";
const IS_STATIC_HOST = location.protocol === "file:" || location.hostname.endsWith("github.io") || new URLSearchParams(location.search).has("static");
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("pt-BR");

let appData = emptyData();
let currentMonth = startOfMonth(new Date());
let paymentFilter = "all";
let paymentView = "list";
let storageMode = IS_STATIC_HOST ? "browser" : "server";
let saveTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await loadData();
  currentMonth = monthWithMostRelevantPayment() || startOfMonth(new Date());
  $("#monthInput").value = monthValue(currentMonth);
  render();
}

function emptyData() {
  return { version: 2, updatedAt: null, settings: { weddingDate: "2026-11-07", couple: "Leonardo & Bruna" }, vendors: [] };
}

async function loadData() {
  const cachedText = localStorage.getItem(LOCAL_CACHE_KEY);
  const cachedData = readJson(cachedText);
  const legacyVendors = readJson(localStorage.getItem(LEGACY_STORAGE_KEY));

  if (IS_STATIC_HOST) {
    if (cachedData?.vendors) {
      appData = normalizeData(cachedData);
    } else if (Array.isArray(legacyVendors) && legacyVendors.length) {
      appData = normalizeData({ ...emptyData(), vendors: legacyVendors });
      await saveData({ immediate: true, message: `${legacyVendors.length} fornecedor(es) recuperados neste navegador` });
    } else {
      try {
        const seedResponse = await fetch("./data/contas.json", { cache: "no-store" });
        if (!seedResponse.ok) throw new Error("Dados iniciais indisponíveis");
        appData = normalizeData(await seedResponse.json());
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(appData));
      } catch {
        appData = emptyData();
        setSaveStatus("Não foi possível carregar os dados iniciais", true);
        return;
      }
    }
    setSaveStatus(appData.updatedAt ? `Salvo neste navegador ${formatDateTime(appData.updatedAt)}` : "Dados salvos neste navegador");
    return;
  }

  let serverData;
  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Servidor de dados indisponível");
    serverData = await response.json();
  } catch (error) {
    serverData = cachedData;
    storageMode = "browser";
    setSaveStatus("Modo de segurança: dados neste navegador", true);
  }

  const shouldMigrateLegacy = (!serverData?.vendors?.length && Array.isArray(legacyVendors) && legacyVendors.length);
  appData = normalizeData(shouldMigrateLegacy ? { ...emptyData(), vendors: legacyVendors } : serverData || emptyData());
  localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(appData));

  if (shouldMigrateLegacy) {
    await saveData({ immediate: true, message: `${legacyVendors.length} fornecedor(es) migrados para o JSON` });
    downloadJson(appData, `backup-migracao-${isoDate(new Date())}.json`);
  } else if (serverData) {
    setSaveStatus(appData.updatedAt ? `Salvo ${formatDateTime(appData.updatedAt)}` : "Arquivo JSON pronto");
  }
}

function normalizeData(data) {
  const base = data && typeof data === "object" ? data : emptyData();
  return {
    version: 2,
    updatedAt: base.updatedAt || null,
    settings: { ...emptyData().settings, ...(base.settings || {}) },
    vendors: Array.isArray(base.vendors) ? base.vendors.map(normalizeVendor) : []
  };
}

function normalizeVendor(vendor) {
  return {
    id: vendor.id || crypto.randomUUID(),
    name: vendor.name || "Fornecedor sem nome",
    description: vendor.description || "",
    category: vendor.category || "Outros",
    status: vendor.status || "contracted",
    contact: vendor.contact || "",
    notes: vendor.notes || "",
    total: number(vendor.total),
    deposit: vendor.noDeposit ? 0 : number(vendor.deposit),
    depositDate: vendor.depositDate || vendor.depositPaidDate || "",
    installmentValue: number(vendor.installmentValue),
    installments: Math.max(0, Number.parseInt(vendor.installments || 0, 10)),
    dueDay: clamp(Number.parseInt(vendor.dueDay || 10, 10), 1, 31),
    firstInstallmentDate: vendor.firstInstallmentDate || "",
    paidPaymentIds: Array.isArray(vendor.paidPaymentIds) ? vendor.paidPaymentIds : [],
    depositPaidDate: vendor.depositPaidDate || "",
    paymentOverrides: vendor.paymentOverrides && typeof vendor.paymentOverrides === "object" ? vendor.paymentOverrides : {}
  };
}

function bindEvents() {
  $$(".tab").forEach((button) => button.addEventListener("click", () => openTab(button.dataset.tab)));
  $("#prevMonth").addEventListener("click", () => changeMonth(-1));
  $("#nextMonth").addEventListener("click", () => changeMonth(1));
  $("#todayButton").addEventListener("click", () => setMonth(new Date()));
  $("#monthInput").addEventListener("change", (event) => setMonth(parseMonth(event.target.value)));
  $("#paymentSearch").addEventListener("input", renderMonth);
  $("#vendorSearch").addEventListener("input", renderVendors);
  $("#vendorSort").addEventListener("change", renderVendors);
  $("#statusFilters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    paymentFilter = button.dataset.filter;
    $$("#statusFilters button").forEach((item) => item.classList.toggle("is-active", item === button));
    renderMonth();
  });
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => {
    paymentView = button.dataset.view;
    $$("[data-view]").forEach((item) => item.classList.toggle("is-active", item === button));
    $("#listView").classList.toggle("is-active", paymentView === "list");
    $("#calendarView").classList.toggle("is-active", paymentView === "calendar");
  }));
  ["#newVendorButton", "#newVendorButtonSecondary"].forEach((selector) => $(selector).addEventListener("click", () => openVendorDialog()));
  $("#vendorForm").addEventListener("submit", handleVendorSubmit);
  $("#paymentForm").addEventListener("submit", handlePaymentSubmit);
  $("#paymentStatus").addEventListener("change", syncPaymentForm);
  $("#paymentTableBody").addEventListener("click", handlePaymentClick);
  $("#calendarGrid").addEventListener("click", handlePaymentClick);
  $("#vendorList").addEventListener("click", handleVendorClick);
  $("#csvButton").addEventListener("click", exportMonthlyCsv);
  $("#printButton").addEventListener("click", () => window.print());
  $("#reportShowGrandTotal").addEventListener("change", renderReport);
  $("#reportCsvButton").addEventListener("click", exportTotalReportCsv);
  $("#reportPrintButton").addEventListener("click", () => window.print());
  ["#backupButton", "#backupButtonSecondary"].forEach((selector) => $(selector).addEventListener("click", exportBackup));
  $("#importButton").addEventListener("click", () => $("#importInput").click());
  $("#importInput").addEventListener("change", importBackup);
  $("#clearButton").addEventListener("click", clearAllData);
}

function openTab(tabName) {
  $$(".tab").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === tabName));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === tabName));
  if (tabName === "overview") renderOverview();
  if (tabName === "report") renderReport();
}

function render() {
  renderSummary();
  renderMonth();
  renderVendors();
  renderOverview();
  renderReport();
  renderSettings();
}

function renderSummary() {
  const payments = allPayments();
  const contracted = appData.vendors.filter((vendor) => vendor.status !== "cancelled").reduce((sum, vendor) => sum + vendor.total, 0);
  const paid = payments.reduce((sum, payment) => sum + payment.paidAmount, 0);
  const pending = Math.max(0, contracted - paid);
  const next = payments.filter((payment) => payment.status !== "paid").sort(sortPayments)[0];
  $("#totalContracted").textContent = currency.format(contracted);
  $("#totalPaid").textContent = currency.format(paid);
  $("#totalPending").textContent = currency.format(pending);
  $("#paidPercent").textContent = `${contracted ? Math.round((paid / contracted) * 100) : 0}% do total`;
  $("#nextPayment").textContent = next ? `${formatDate(next.dueDate)} · ${currency.format(next.expectedAmount)}` : "Tudo pago";
  const weddingDate = dateFromIso(appData.settings.weddingDate);
  const days = Math.max(0, Math.ceil((weddingDate - startOfDay(new Date())) / 86400000));
  $("#daysToWedding").textContent = `${days} dias para o casamento`;
}

function renderMonth() {
  const duePayments = allPayments().filter((payment) => sameMonth(dateFromIso(payment.dueDate), currentMonth));
  const paidThisMonth = allPayments().filter((payment) => payment.paidDate && sameMonth(dateFromIso(payment.paidDate), currentMonth)).reduce((sum, payment) => sum + payment.paidAmount, 0);
  const expected = duePayments.reduce((sum, payment) => sum + payment.expectedAmount, 0);
  const pending = duePayments.reduce((sum, payment) => sum + Math.max(0, payment.expectedAmount - payment.paidAmount), 0);
  const overdue = duePayments.filter((payment) => payment.displayStatus === "overdue").reduce((sum, payment) => sum + Math.max(0, payment.expectedAmount - payment.paidAmount), 0);
  $("#monthTitle").textContent = `Contas de ${monthName.format(currentMonth)}`;
  $("#monthInput").value = monthValue(currentMonth);
  $("#monthTotal").textContent = currency.format(expected);
  $("#monthPaid").textContent = currency.format(paidThisMonth);
  $("#monthPending").textContent = currency.format(pending);
  $("#monthOverdue").textContent = currency.format(overdue);

  const query = normalizeText($("#paymentSearch").value);
  const filtered = duePayments.filter((payment) => {
    const matchesText = !query || normalizeText(`${payment.vendorName} ${payment.label} ${payment.description}`).includes(query);
    const matchesStatus = paymentFilter === "all" || payment.displayStatus === paymentFilter || (paymentFilter === "pending" && payment.displayStatus === "partial");
    return matchesText && matchesStatus;
  }).sort(sortPayments);
  renderPaymentTable(filtered);
  renderCalendar(duePayments);
}

function renderPaymentTable(payments) {
  const tbody = $("#paymentTableBody");
  tbody.innerHTML = payments.map((payment) => `
    <tr>
      <td class="date-cell"><strong>${formatDate(payment.dueDate)}</strong><small>${weekday(payment.dueDate)}</small></td>
      <td class="vendor-cell"><strong>${h(payment.vendorName)}</strong><small>${h(payment.category)}</small></td>
      <td>${h(payment.label)}</td>
      <td class="money">${currency.format(payment.expectedAmount)}</td>
      <td class="money">${payment.paidAmount ? currency.format(payment.paidAmount) : "-"}</td>
      <td class="status-cell"><span class="status-badge ${payment.displayStatus}">${statusLabel(payment.displayStatus)}</span></td>
      <td class="action-cell"><button class="row-action" type="button" data-payment-id="${h(payment.id)}" data-vendor-id="${h(payment.vendorId)}">Editar</button></td>
    </tr>`).join("");
  $("#paymentEmpty").hidden = payments.length > 0;
  $(".table-wrap").hidden = payments.length === 0;
}

function renderCalendar(payments) {
  const grid = $("#calendarGrid");
  const first = startOfMonth(currentMonth);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const byDay = Object.groupBy ? Object.groupBy(payments, (item) => item.dueDate) : payments.reduce((map, item) => ((map[item.dueDate] ||= []).push(item), map), {});
  grid.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = addDays(start, index);
    const key = isoDate(day);
    const items = (byDay[key] || []).map((payment) => `<button class="calendar-payment ${payment.displayStatus}" type="button" data-payment-id="${h(payment.id)}" data-vendor-id="${h(payment.vendorId)}"><strong>${h(payment.vendorName)}</strong><br>${currency.format(payment.expectedAmount)}</button>`).join("");
    return `<div class="day-cell ${sameMonth(day, currentMonth) ? "" : "is-outside"}"><div class="day-number">${day.getDate()}</div>${items}</div>`;
  }).join("");
}

function renderVendors() {
  const query = normalizeText($("#vendorSearch").value);
  const sort = $("#vendorSort").value;
  const vendors = appData.vendors.filter((vendor) => !query || normalizeText(`${vendor.name} ${vendor.category} ${vendor.contact}`).includes(query));
  vendors.sort((a, b) => {
    if (sort === "total") return b.total - a.total;
    if (sort === "pending") return vendorPending(b) - vendorPending(a);
    if (sort === "next") return (nextVendorPayment(a)?.dueDate || "9999") .localeCompare(nextVendorPayment(b)?.dueDate || "9999");
    return a.name.localeCompare(b.name, "pt-BR");
  });
  $("#vendorList").innerHTML = vendors.map((vendor) => {
    const paid = vendorPayments(vendor).reduce((sum, payment) => sum + payment.paidAmount, 0);
    const next = nextVendorPayment(vendor);
    return `<article class="vendor-card">
      <div class="vendor-title"><span class="category-swatch"></span><div><h3>${h(vendor.name)}</h3><p>${h(vendor.category)} · ${h(vendorStatusLabel(vendor.status))}${vendor.contact ? ` · ${h(vendor.contact)}` : ""}</p></div></div>
      <div class="vendor-stat"><span>Contrato</span><strong>${currency.format(vendor.total)}</strong></div>
      <div class="vendor-stat"><span>Já pago</span><strong>${currency.format(paid)}</strong></div>
      <div class="vendor-stat"><span>Próximo</span><strong>${next ? formatDate(next.dueDate) : "-"}</strong></div>
      <div class="vendor-actions"><button class="row-action" data-vendor-action="edit" data-vendor-id="${h(vendor.id)}">Editar</button><button class="row-action" data-vendor-action="delete" data-vendor-id="${h(vendor.id)}">Excluir</button></div>
    </article>`;
  }).join("");
  $("#vendorEmpty").hidden = vendors.length > 0;
}

function renderOverview() {
  const payments = allPayments();
  const total = appData.vendors.filter((vendor) => vendor.status !== "cancelled").reduce((sum, vendor) => sum + vendor.total, 0);
  const paid = payments.reduce((sum, payment) => sum + payment.paidAmount, 0);
  const percent = total ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  $("#progressBar").style.width = `${percent}%`;
  $("#progressText").textContent = `${percent}% pago · ${currency.format(Math.max(0, total - paid))} ainda previstos`;
  const categories = appData.vendors.reduce((map, vendor) => ((map[vendor.category] = (map[vendor.category] || 0) + vendor.total), map), {});
  const maxCategory = Math.max(1, ...Object.values(categories));
  $("#categorySummary").innerHTML = Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([name, value]) => `<div class="breakdown-row"><span>${h(name)}</span><strong>${currency.format(value)}</strong><div><span style="width:${(value / maxCategory) * 100}%"></span></div></div>`).join("") || "<p>Nenhum dado ainda.</p>";
  const byMonth = allPayments().reduce((map, payment) => { const key = payment.dueDate.slice(0, 7); map[key] = (map[key] || 0) + payment.expectedAmount; return map; }, {});
  const entries = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
  const maxMonth = Math.max(1, ...entries.map(([, value]) => value));
  $("#monthlyProjection").innerHTML = entries.map(([key, value]) => `<div class="projection-item"><div class="projection-bar" style="height:${Math.max(3, (value / maxMonth) * 170)}px"></div><strong>${currency.format(value)}</strong><span>${monthName.format(parseMonth(key))}</span></div>`).join("") || "<p>Nenhuma parcela programada.</p>";
}

function renderReport() {
  const rows = totalReportRows();
  const showGrandTotal = $("#reportShowGrandTotal").checked;
  const contracted = rows.reduce((sum, row) => sum + row.contracted, 0);
  const paid = rows.reduce((sum, row) => sum + row.paid, 0);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  $("#reportGeneratedAt").textContent = `Atualizado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`;
  $("#reportContracted").textContent = currency.format(contracted);
  $("#reportPaid").textContent = currency.format(paid);
  $("#reportPending").textContent = currency.format(pending);
  $("#reportTableBody").innerHTML = rows.map((row) => `
    <tr>
      <td class="vendor-cell"><strong>${h(row.vendor.name)}</strong><small>${h(row.vendor.category)}</small></td>
      <td class="money">${currency.format(row.contracted)}</td>
      <td class="payment-history">${row.history.length ? row.history.map((payment) => `<span><strong>${payment.paidDate ? formatDate(payment.paidDate) : "Data não informada"}</strong> · ${h(payment.label)} · ${currency.format(payment.paidAmount)}</span>`).join("") : '<span class="no-payment">Nenhum pagamento registrado</span>'}</td>
      <td class="money paid-value">${currency.format(row.paid)}</td>
      <td class="money pending-value">${currency.format(row.pending)}</td>
    </tr>`).join("");
  $("#reportTableFoot").innerHTML = showGrandTotal ? `<tr><th>Total geral</th><th class="money">${currency.format(contracted)}</th><th></th><th class="money">${currency.format(paid)}</th><th class="money">${currency.format(pending)}</th></tr>` : "";
}

function totalReportRows() {
  return appData.vendors
    .filter((vendor) => vendor.status !== "cancelled")
    .map((vendor) => {
      const history = vendorPayments(vendor)
        .filter((payment) => payment.paidAmount > 0)
        .sort((a, b) => (a.paidDate || a.dueDate).localeCompare(b.paidDate || b.dueDate));
      const paid = history.reduce((sum, payment) => sum + payment.paidAmount, 0);
      return { vendor, contracted: vendor.total, history, paid, pending: Math.max(0, vendor.total - paid) };
    })
    .sort((a, b) => a.vendor.name.localeCompare(b.vendor.name, "pt-BR"));
}

function renderSettings() {
  $("#lastSaved").textContent = appData.updatedAt ? formatDateTime(appData.updatedAt) : "Ainda não gravado";
  $("#vendorCount").textContent = appData.vendors.length;
  $("#storageDescription").textContent = storageMode === "browser"
    ? "As alterações ficam somente neste navegador. Baixe o backup JSON ao terminar para compartilhar ou restaurar em outro aparelho."
    : "As alterações são gravadas no arquivo data/contas.json deste computador e também mantidas neste navegador.";
}

function vendorPayments(vendor) {
  const payments = [];
  if (vendor.deposit > 0 && vendor.depositDate) payments.push(basePayment(vendor, `${vendor.id}-entrada`, "Entrada", vendor.deposit, vendor.depositDate));
  if (vendor.installmentValue > 0 && vendor.installments > 0 && vendor.firstInstallmentDate) {
    const [year, month] = vendor.firstInstallmentDate.split("-").map(Number);
    for (let index = 0; index < vendor.installments; index += 1) {
      const monthDate = new Date(year, month - 1 + index, 1);
      const dueDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(vendor.dueDay, daysInMonth(monthDate)));
      payments.push(basePayment(vendor, `${vendor.id}-parcela-${index + 1}`, `Parcela ${index + 1}/${vendor.installments}`, vendor.installmentValue, isoDate(dueDate)));
    }
  }
  return payments;
}

function basePayment(vendor, id, label, expectedAmount, dueDate) {
  const override = vendor.paymentOverrides[id] || {};
  const legacyPaid = vendor.paidPaymentIds.includes(id) || (label === "Entrada" && Boolean(vendor.depositPaidDate));
  const status = override.status || (legacyPaid ? "paid" : "pending");
  const finalExpected = number(override.expectedAmount ?? expectedAmount);
  const paidAmount = status === "paid" ? number(override.paidAmount ?? finalExpected) : number(override.paidAmount);
  const finalDueDate = override.dueDate || dueDate;
  const paidDate = override.paidDate || (label === "Entrada" ? vendor.depositPaidDate : "");
  const displayStatus = status === "pending" && dateFromIso(finalDueDate) < startOfDay(new Date()) ? "overdue" : status;
  return { id, vendorId: vendor.id, vendorName: vendor.name, category: vendor.category, description: vendor.description, label, expectedAmount: finalExpected, dueDate: finalDueDate, status, displayStatus, paidAmount, paidDate, method: override.method || "", notes: override.notes || "" };
}

function allPayments() {
  return appData.vendors.filter((vendor) => vendor.status !== "cancelled").flatMap(vendorPayments);
}

function openVendorDialog(vendorId) {
  const vendor = appData.vendors.find((item) => item.id === vendorId);
  $("#vendorDialogTitle").textContent = vendor ? "Editar fornecedor" : "Novo fornecedor";
  $("#vendorId").value = vendor?.id || "";
  $("#vendorName").value = vendor?.name || "";
  $("#vendorDescription").value = vendor?.description || "";
  $("#vendorCategory").value = vendor?.category || "Outros";
  $("#vendorStatus").value = vendor?.status || "contracted";
  $("#vendorContact").value = vendor?.contact || "";
  $("#vendorTotal").value = vendor?.total || "";
  $("#vendorDeposit").value = vendor?.deposit || 0;
  $("#vendorDepositDate").value = vendor?.depositDate || "";
  $("#vendorInstallmentValue").value = vendor?.installmentValue || 0;
  $("#vendorInstallments").value = vendor?.installments || 0;
  $("#vendorFirstInstallment").value = vendor?.firstInstallmentDate || "";
  $("#vendorDueDay").value = vendor?.dueDay || 10;
  $("#vendorNotes").value = vendor?.notes || "";
  $("#vendorDialog").showModal();
}

async function handleVendorSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return $("#vendorDialog").close();
  if (!event.currentTarget.reportValidity()) return;
  const id = $("#vendorId").value || crypto.randomUUID();
  const existing = appData.vendors.find((vendor) => vendor.id === id);
  const vendor = normalizeVendor({ ...existing, id, name: $("#vendorName").value.trim(), description: $("#vendorDescription").value.trim(), category: $("#vendorCategory").value, status: $("#vendorStatus").value, contact: $("#vendorContact").value.trim(), total: number($("#vendorTotal").value), deposit: number($("#vendorDeposit").value), depositDate: $("#vendorDepositDate").value, installmentValue: number($("#vendorInstallmentValue").value), installments: Number.parseInt($("#vendorInstallments").value || 0, 10), firstInstallmentDate: $("#vendorFirstInstallment").value, dueDay: Number.parseInt($("#vendorDueDay").value || 10, 10), notes: $("#vendorNotes").value.trim() });
  appData.vendors = existing ? appData.vendors.map((item) => item.id === id ? vendor : item) : [...appData.vendors, vendor];
  $("#vendorDialog").close();
  await saveData({ message: "Fornecedor salvo" });
  render();
}

function handleVendorClick(event) {
  const button = event.target.closest("button[data-vendor-action]");
  if (!button) return;
  const vendor = appData.vendors.find((item) => item.id === button.dataset.vendorId);
  if (!vendor) return;
  if (button.dataset.vendorAction === "edit") openVendorDialog(vendor.id);
  if (button.dataset.vendorAction === "delete" && confirm(`Excluir ${vendor.name} e todos os pagamentos relacionados?`)) {
    appData.vendors = appData.vendors.filter((item) => item.id !== vendor.id);
    saveData({ message: "Fornecedor excluído" }).then(render);
  }
}

function handlePaymentClick(event) {
  const button = event.target.closest("button[data-payment-id]");
  if (button) openPaymentDialog(button.dataset.vendorId, button.dataset.paymentId);
}

function openPaymentDialog(vendorId, paymentId) {
  const payment = allPayments().find((item) => item.vendorId === vendorId && item.id === paymentId);
  if (!payment) return;
  $("#paymentDialogTitle").textContent = payment.status === "pending" ? "Registrar pagamento" : "Editar pagamento";
  $("#paymentId").value = payment.id;
  $("#paymentVendorId").value = payment.vendorId;
  $("#paymentContext").innerHTML = `<strong>${h(payment.vendorName)}</strong><br>${h(payment.label)} · ${currency.format(payment.expectedAmount)}`;
  $("#paymentDueDate").value = payment.dueDate;
  $("#paymentExpected").value = payment.expectedAmount;
  $("#paymentStatus").value = payment.status;
  $("#paymentPaidAmount").value = payment.paidAmount || "";
  $("#paymentPaidDate").value = payment.paidDate || "";
  $("#paymentMethod").value = payment.method || "";
  $("#paymentNotes").value = payment.notes || "";
  syncPaymentForm();
  $("#paymentDialog").showModal();
}

function syncPaymentForm() {
  const status = $("#paymentStatus").value;
  const isPending = status === "pending";
  $("#paymentPaidAmount").disabled = isPending;
  $("#paymentPaidDate").disabled = isPending;
  $("#paymentMethod").disabled = isPending;
  if (status === "paid" && !$("#paymentPaidAmount").value) $("#paymentPaidAmount").value = $("#paymentExpected").value;
  if (status === "paid" && !$("#paymentPaidDate").value) $("#paymentPaidDate").value = isoDate(new Date());
  if (isPending) { $("#paymentPaidAmount").value = ""; $("#paymentPaidDate").value = ""; }
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return $("#paymentDialog").close();
  if (!event.currentTarget.reportValidity()) return;
  const vendor = appData.vendors.find((item) => item.id === $("#paymentVendorId").value);
  if (!vendor) return;
  const id = $("#paymentId").value;
  const status = $("#paymentStatus").value;
  vendor.paymentOverrides[id] = { dueDate: $("#paymentDueDate").value, expectedAmount: number($("#paymentExpected").value), status, paidAmount: status === "pending" ? 0 : number($("#paymentPaidAmount").value), paidDate: status === "pending" ? "" : $("#paymentPaidDate").value, method: status === "pending" ? "" : $("#paymentMethod").value, notes: $("#paymentNotes").value.trim() };
  vendor.paidPaymentIds = vendor.paidPaymentIds.filter((paymentId) => paymentId !== id);
  $("#paymentDialog").close();
  await saveData({ message: "Pagamento atualizado" });
  render();
}

async function saveData({ message = "Alterações salvas", immediate = false } = {}) {
  clearTimeout(saveTimer);
  setSaveStatus("Salvando...");
  const perform = async () => {
    if (storageMode === "browser") {
      appData.updatedAt = new Date().toISOString();
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(appData));
      setSaveStatus(`Salvo neste navegador ${formatDateTime(appData.updatedAt)}`);
      renderSettings();
      showToast(message);
      return;
    }
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(appData));
    try {
      const response = await fetch(API_URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(appData) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao salvar");
      appData.updatedAt = result.updatedAt;
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(appData));
      setSaveStatus(`Salvo ${formatDateTime(result.updatedAt)}`);
      renderSettings();
      showToast(message);
    } catch (error) {
      setSaveStatus("Não gravou no arquivo; cópia mantida no navegador", true);
      showToast("Não foi possível gravar no JSON. Inicie com npm start.");
    }
  };
  if (immediate) return perform();
  return new Promise((resolve) => { saveTimer = setTimeout(() => perform().finally(resolve), 120); });
}

function exportMonthlyCsv() {
  const payments = allPayments().filter((payment) => sameMonth(dateFromIso(payment.dueDate), currentMonth)).sort(sortPayments);
  const rows = [["Vencimento", "Pagamento", "Fornecedor", "Categoria", "Descrição", "Valor previsto", "Valor pago", "Situação", "Data do pagamento", "Forma", "Observação"]];
  payments.forEach((payment) => rows.push([formatDate(payment.dueDate), payment.label, payment.vendorName, payment.category, payment.description, decimal(payment.expectedAmount), decimal(payment.paidAmount), statusLabel(payment.displayStatus), payment.paidDate ? formatDate(payment.paidDate) : "", payment.method, payment.notes]));
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  downloadBlob(`\ufeff${csv}`, `relatorio-${monthValue(currentMonth)}.csv`, "text/csv;charset=utf-8");
  showToast("Relatório CSV gerado");
}

function exportTotalReportCsv() {
  const reportRows = totalReportRows();
  const showGrandTotal = $("#reportShowGrandTotal").checked;
  const rows = [["Fornecedor", "Categoria", "Valor contratado", "Datas e pagamentos realizados", "Total pago", "Falta pagar"]];
  reportRows.forEach((row) => {
    const history = row.history.map((payment) => `${payment.paidDate ? formatDate(payment.paidDate) : "Data não informada"} - ${payment.label} - ${currency.format(payment.paidAmount)}`).join(" | ");
    rows.push([row.vendor.name, row.vendor.category, decimal(row.contracted), history || "Nenhum pagamento registrado", decimal(row.paid), decimal(row.pending)]);
  });
  if (showGrandTotal) {
    rows.push([
      "TOTAL GERAL",
      "",
      decimal(reportRows.reduce((sum, row) => sum + row.contracted, 0)),
      "",
      decimal(reportRows.reduce((sum, row) => sum + row.paid, 0)),
      decimal(reportRows.reduce((sum, row) => sum + row.pending, 0))
    ]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  downloadBlob(`\ufeff${csv}`, `relatorio-total-casamento-${isoDate(new Date())}.csv`, "text/csv;charset=utf-8");
  showToast("Relatório total CSV gerado");
}

function exportBackup() { downloadJson(appData, `backup-casamento-${isoDate(new Date())}.json`); }

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const imported = normalizeData(JSON.parse(await file.text()));
    if (!confirm(`Importar ${imported.vendors.length} fornecedor(es) e substituir os dados atuais?`)) return;
    exportBackup();
    appData = imported;
    await saveData({ immediate: true, message: "Backup importado" });
    render();
  } catch { showToast("Arquivo de backup inválido"); }
}

async function clearAllData() {
  if (!confirm("Apagar todos os fornecedores e pagamentos? Um backup será baixado antes.")) return;
  exportBackup();
  appData = emptyData();
  await saveData({ immediate: true, message: "Dados apagados" });
  render();
}

function monthWithMostRelevantPayment() {
  const pending = allPayments().filter((payment) => payment.status !== "paid").sort(sortPayments)[0];
  return pending ? startOfMonth(dateFromIso(pending.dueDate)) : null;
}
function nextVendorPayment(vendor) { return vendorPayments(vendor).filter((payment) => payment.status !== "paid").sort(sortPayments)[0]; }
function vendorPending(vendor) { return Math.max(0, vendor.total - vendorPayments(vendor).reduce((sum, payment) => sum + payment.paidAmount, 0)); }
function changeMonth(offset) { setMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1)); }
function setMonth(date) { currentMonth = startOfMonth(date); renderMonth(); }
function sortPayments(a, b) { return a.dueDate.localeCompare(b.dueDate) || a.vendorName.localeCompare(b.vendorName, "pt-BR"); }
function statusLabel(status) { return ({ paid: "Pago", pending: "Pendente", overdue: "Atrasado", partial: "Parcial" })[status] || status; }
function vendorStatusLabel(status) { return ({ contracted: "Contratado", quote: "Cotação", completed: "Concluído", cancelled: "Cancelado" })[status] || status; }
function setSaveStatus(text, error = false) { $("#saveStatus").textContent = text; $("#saveStatus").style.color = error ? "var(--red)" : ""; }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("is-visible"); setTimeout(() => toast.classList.remove("is-visible"), 2600); }
function downloadJson(value, filename) { downloadBlob(JSON.stringify(value, null, 2), filename, "application/json"); }
function downloadBlob(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function decimal(value) { return number(value).toFixed(2).replace(".", ","); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function readJson(value) { try { return JSON.parse(value); } catch { return null; } }
function h(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function normalizeText(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
function addDays(date, days) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days); }
function daysInMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); }
function monthValue(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function parseMonth(value) { const [year, month] = value.split("-").map(Number); return new Date(year, month - 1, 1); }
function isoDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function dateFromIso(value) { const [year, month, day = 1] = String(value).split("-").map(Number); return new Date(year, month - 1, day); }
function formatDate(value) { return value ? shortDate.format(dateFromIso(value)) : "-"; }
function weekday(value) { return new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(dateFromIso(value)); }
function formatDateTime(value) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
