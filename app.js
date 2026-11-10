/* 화면 표시·화면 전환·사용자 입력과 이벤트를 담당합니다. */
(function () {
"use strict";
const $ = id => document.getElementById(id);
const Logic = window.CustomerLogic;
const repository = window.AppStorage.createRepository();
const today = Logic.today;
let customers = [], items = [], selectedId = null, editingCustomerId = null, editingVisitId = null;
let editingItemName = null;
let screen = "list", baseline = "", blocked = false, blockReason = "";
function textElement(tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function message(text = "", error = false) {
  $("status").textContent = text; $("status").hidden = !text;
  $("status").classList.toggle("error", error);
}
function customerData() {
  return { name:$("name").value.trim(), phone:$("phone").value.trim(), visit:$("first-visit").value, memo:$("basic-memo").value };
}
function visitData() {
  return { date:$("visit-date").value, items:Array.from(document.querySelectorAll(".choice input:checked"), el => el.value), memo:$("visit-memo").value };
}
function snapshot() {
  if (screen === "customer") return JSON.stringify(customerData());
  if (screen === "visit") return JSON.stringify(visitData());
  if (screen === "settings") return $("item-name").value;
  return "";
}
function dirty() { return snapshot() !== baseline; }
function mayLeave() { return !dirty() || confirm("저장하지 않은 내용이 있습니다. 변경 내용을 버릴까요?"); }
function switchScreen(next, focus = true) {
  screen = next;
  for (const name of ["list", "customer", "detail", "visit", "settings"]) $(name + "-screen").hidden = name !== next;
  baseline = snapshot(); message(blocked ? blockReason : "",blocked);
  if (focus) {
    const title = $(({list:"list-title",customer:"customer-title",detail:"detail-title",visit:"visit-title",settings:"settings-title"})[next]);
    title.focus({preventScroll:true}); window.scrollTo({top:0,behavior:"instant"});
  }
}
function currentCustomer() { return customers.find(c => c.id === selectedId); }
function blockSaving(text) {
  blocked = true; blockReason = text; $("customer-fields").disabled = true; $("visit-fields").disabled = true; $("item-fields").disabled = true;
  document.querySelectorAll("[data-write]").forEach(el => { el.disabled = true; }); message(text,true);
}
function handleSaveError(error) {
  if (error.code === "STORAGE_CONFLICT") { blockSaving(error.message); return; }
  message("저장하지 못했습니다. 브라우저 저장 설정과 남은 공간을 확인하세요. 입력 내용은 그대로 남아 있습니다.", true);
}
function handleValidationError(error) {
  message(error.message, true);
  const field = error.field && $(error.field);
  if (field) {
    const focusTarget = field.id === "item-choices" ? field.querySelector("input") : field;
    if (focusTarget) focusTarget.focus();
  }
}
function persist(next) {
  if (blocked) return false;
  try { repository.saveCustomers(next); customers = next; return true; }
  catch (error) { handleSaveError(error); return false; }
}
function persistItems(next) {
  if (blocked) return false;
  try { repository.saveItems(next); items = next; return true; }
  catch (error) { handleSaveError(error); return false; }
}
function renderList() {
  const query = $("search").value.trim().toLocaleLowerCase();
  const visible = Logic.searchCustomers(customers, query);
  $("count").textContent = query ? `검색 결과 ${visible.length}명 / 전체 ${customers.length}명` : `전체 ${customers.length}명`;
  $("customers").replaceChildren(); $("list-empty").hidden = visible.length > 0;
  $("list-empty").textContent = customers.length ? "검색된 고객이 없습니다." : "등록된 고객이 없습니다. 고객 등록 버튼을 눌러주세요.";
  visible.forEach(c => {
    const li = document.createElement("li"), button = document.createElement("button");
    button.type = "button"; button.className = "customer";
    const info = document.createElement("span"); info.append(textElement("strong",c.name),textElement("span",c.phone,"phone"));
    button.append(info,textElement("span",`첫 방문 ${c.visit}  ›`,"date"));
    button.addEventListener("click",() => { selectedId = c.id; showDetail(); });
    li.append(button); $("customers").append(li);
  });
}
function showList(focus = true) { renderList(); switchScreen("list",focus); }
function showCustomerForm(customer = null) {
  if (blocked) return;
  editingCustomerId = customer ? customer.id : null;
  $("customer-title").textContent = customer ? "기본정보 수정" : "고객 등록";
  $("name").value = customer ? customer.name : ""; $("phone").value = customer ? customer.phone : "";
  $("phone").setCustomValidity(""); $("first-visit").value = customer ? customer.visit : today();
  $("first-visit").max = today(); $("basic-memo").value = customer ? customer.memo : ""; switchScreen("customer");
}
function showDetail() {
  const c = currentCustomer(); if (!c) { showList(); return; }
  $("detail-title").textContent = c.name; $("detail-phone").textContent = c.phone; $("detail-first-visit").textContent = c.visit;
  $("detail-memo").textContent = c.memo || "등록된 기본 메모가 없습니다.";
  $("visit-list").replaceChildren(); $("visit-empty").hidden = c.visits.length > 0;
  Logic.sortedVisits(c.visits).forEach(v => {
    const card = document.createElement("article"); card.className = "visit-card";
    const top = document.createElement("div"); top.className = "visit-top";
    const date = textElement("time",v.date); date.dateTime = v.date;
    const actions = document.createElement("div"); actions.className = "row";
    const edit = textElement("button","수정"), remove = textElement("button","삭제","danger");
    for (const button of [edit,remove]) { button.type = "button"; button.dataset.write = ""; button.disabled = blocked; }
    edit.setAttribute("aria-label",`${v.date} 관리 기록 수정`); remove.setAttribute("aria-label",`${v.date} 관리 기록 삭제`);
    edit.addEventListener("click",() => showVisitForm(v)); remove.addEventListener("click",() => deleteVisit(v.id));
    actions.append(edit,remove); top.append(date,actions);
    const tags = document.createElement("div"); tags.className = "tags";
    v.items.forEach(item => tags.append(textElement("span",item,"tag")));
    card.append(top,tags,textElement("p",v.memo || "등록된 메모가 없습니다.","memo")); $("visit-list").append(card);
  });
  switchScreen("detail");
}
function showVisitForm(visit = null) {
  if (blocked) return; const c = currentCustomer(); if (!c) return;
  editingVisitId = visit ? visit.id : null;
  $("visit-title").textContent = visit ? "관리 기록 수정" : "관리 기록 추가";
  $("visit-customer").textContent = `${c.name}님의 방문별 관리 기록`;
  $("visit-date").value = visit ? visit.date : today(); $("visit-date").max = today();
  renderChoices(visit ? visit.items : []);
  $("visit-memo").value = visit ? visit.memo : ""; switchScreen("visit");
}
function cancelCustomer() { if (mayLeave()) { if (editingCustomerId) showDetail(); else showList(); } }
function cancelVisit() { if (mayLeave()) showDetail(); }
function deleteVisit(id) {
  if (blocked) return; const c = currentCustomer(), visit = c && c.visits.find(v => v.id === id);
  if (!visit || !confirm(`${visit.date} 관리 기록을 삭제할까요?\n삭제한 기록은 되돌릴 수 없습니다.`)) return;
  const next = Logic.removeVisit(customers,c.id,id);
  if (persist(next)) { showDetail(); message("관리 기록을 삭제했습니다."); }
}
function renderChoices(previousItems) {
  $("item-choices").replaceChildren();
  const choices = Logic.visitChoices(items, previousItems);
  choices.forEach(choice => {
    const label = document.createElement("label"); label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox"; input.name = "items"; input.value = choice.name;
    input.checked = previousItems.includes(choice.name); input.disabled = blocked;
    const text = choice.historical ? choice.name + " (과거 항목)" : choice.name;
    label.append(input,textElement("span",text)); $("item-choices").append(label);
  });
  $("items-help").textContent = choices.length
    ? "해당하는 항목을 모두 선택하세요. 과거 항목은 기존 기록을 수정할 때만 표시됩니다."
    : "선택할 항목이 없습니다. 고객 목록의 관리 항목 설정에서 항목을 추가해 주세요.";
}
function resetItemEditor(name = null) {
  editingItemName = name;
  $("item-name").value = name || "";
  $("item-editor-title").textContent = name === null ? "새 항목 추가" : "항목 이름 수정";
  $("item-submit").textContent = name === null ? "추가하기" : "이름 저장";
  $("item-cancel").hidden = name === null;
  baseline = snapshot();
}
function renderSettings() {
  $("settings-items").replaceChildren();
  $("settings-empty").hidden = items.length > 0;
  items.forEach(name => {
    const row = document.createElement("li"); row.className = "setting-item";
    const label = textElement("strong",name,"setting-name");
    const actions = document.createElement("div"); actions.className = "row";
    const edit = textElement("button","수정"), remove = textElement("button","삭제","danger");
    for (const button of [edit,remove]) { button.type = "button"; button.dataset.write = ""; button.disabled = blocked; }
    edit.setAttribute("aria-label",name + " 이름 수정");
    remove.setAttribute("aria-label",name + " 항목 삭제");
    edit.addEventListener("click",() => {
      if (blocked || !mayLeave()) return;
      resetItemEditor(name); message(); $("item-name").focus();
    });
    remove.addEventListener("click",() => {
      if (blocked || !confirm(name + " 항목을 선택 목록에서 삭제할까요?\n과거 관리 기록에 저장된 항목과 메모는 그대로 유지됩니다.")) return;
      if (!persistItems(Logic.removeItem(items,name))) return;
      if (editingItemName === name) resetItemEditor();
      renderSettings(); message("관리 항목을 삭제했습니다. 과거 기록은 유지됩니다.");
    });
    actions.append(edit,remove); row.append(label,actions); $("settings-items").append(row);
  });
}
function showSettings() {
  resetItemEditor(); renderSettings(); switchScreen("settings");
}
$("open-settings").addEventListener("click",showSettings);
$("settings-back").addEventListener("click",() => { if (mayLeave()) showList(); });
$("item-cancel").addEventListener("click",() => { if (mayLeave()) { resetItemEditor(); message(); } });
$("item-form").addEventListener("submit",event => {
  event.preventDefault();
  if (blocked || !$("item-form").reportValidity()) return;
  try {
    const wasEditing = editingItemName !== null;
    const next = Logic.saveItem(items,editingItemName,$("item-name").value);
    if (!persistItems(next)) return;
    resetItemEditor(); renderSettings();
    message(wasEditing ? "관리 항목 이름을 수정했습니다. 과거 기록은 당시 이름으로 유지됩니다." : "관리 항목을 추가했습니다.");
    $("item-name").focus();
  } catch (error) { handleValidationError(error); }
});
$("search").addEventListener("input",renderList);
$("new-customer").addEventListener("click",() => showCustomerForm());
$("customer-back").addEventListener("click",cancelCustomer); $("customer-cancel").addEventListener("click",cancelCustomer);
$("detail-back").addEventListener("click",() => showList());
$("edit-customer").addEventListener("click",() => showCustomerForm(currentCustomer()));
$("new-visit").addEventListener("click",() => showVisitForm());
$("visit-back").addEventListener("click",cancelVisit); $("visit-cancel").addEventListener("click",cancelVisit);
$("phone").addEventListener("input",() => $("phone").setCustomValidity(""));
$("customer-form").addEventListener("submit",event => {
  event.preventDefault();
  if (blocked || !$("customer-form").reportValidity()) return;
  try {
    const result = Logic.upsertCustomer(customers,editingCustomerId,customerData());
    if (!persist(result.customers)) return;
    selectedId = result.customer.id;
    const editing = editingCustomerId !== null;
    showDetail(); message(editing ? "기본정보를 수정했습니다." : "고객을 등록했습니다.");
  } catch (error) { handleValidationError(error); }
});
$("visit-form").addEventListener("submit",event => {
  event.preventDefault();
  if (blocked || !$("visit-form").reportValidity()) return;
  try {
    const next = Logic.upsertVisit(customers,selectedId,editingVisitId,visitData(),items);
    if (!persist(next)) return;
    const editing = editingVisitId !== null;
    showDetail(); message(editing ? "관리 기록을 수정했습니다." : "관리 기록을 추가했습니다.");
  } catch (error) { handleValidationError(error); }
});
$("delete-customer").addEventListener("click",() => {
  if (blocked) return; const c = currentCustomer();
  if (!c || !confirm(`${c.name}님의 고객 정보와 방문별 관리 기록 ${c.visits.length}건을 모두 삭제할까요?\n삭제한 정보는 되돌릴 수 없습니다.`)) return;
  if (persist(Logic.removeCustomer(customers,c.id))) { selectedId = null; showList(); message("고객 정보를 삭제했습니다."); }
});
window.addEventListener("beforeunload",event => { if (dirty()) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("storage",event => {
  if (repository.isRelevantChange(event.key)) blockSaving("다른 창에서 저장 정보가 변경되었습니다. 입력 내용을 따로 복사한 뒤 새로고침하세요. 덮어쓰기를 막기 위해 저장을 중지했습니다.");
});
try {
  const data = repository.load();
  customers = data.customers || [];
  items = data.items;
  if (data.customers === null) {
    const samples = Logic.sampleCustomers();
    repository.saveCustomers(samples); customers = samples;
  }
  showList(false);
} catch {
  showList(false);
  blockSaving("저장 공간에 접근할 수 없거나 데이터 형식에 문제가 있습니다. 기존 데이터를 보호하기 위해 저장을 중지했습니다. 기존 데이터는 덮어쓰지 않았습니다.");
}

})();
