/* 고객·방문·관리 항목의 검증과 변경 규칙. 화면과 저장소에 접근하지 않습니다. */
(function () {
  "use strict";
  const DEFAULT_ITEMS = Object.freeze(["여드름", "주름", "미백", "보습", "진정", "리프팅", "바디", "기타"]);

  function today() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function digits(text) { return text.replace(/\D/g, ""); }
  function validDate(text) { return typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text); }
  function nonemptyString(value) { return typeof value === "string" && value.trim().length > 0; }

  function validationError(message, field) {
    const error = new Error(message);
    error.field = field;
    return error;
  }

  function validVisit(visit) {
    // 과거 항목 이름은 현재 설정에 의존하지 않아 삭제·이름 변경 후에도 읽을 수 있습니다.
    return visit && typeof visit.id === "string" && validDate(visit.date) &&
      Array.isArray(visit.items) && visit.items.every(nonemptyString) && typeof visit.memo === "string";
  }

  function validCustomer(customer) {
    return customer && typeof customer.id === "string" && nonemptyString(customer.name) &&
      typeof customer.phone === "string" && validDate(customer.visit) && typeof customer.memo === "string" &&
      (customer.visits === undefined || (Array.isArray(customer.visits) && customer.visits.every(validVisit) &&
        new Set(customer.visits.map(visit => visit.id)).size === customer.visits.length));
  }

  function validCustomers(customers) {
    return Array.isArray(customers) && customers.every(validCustomer) &&
      new Set(customers.map(customer => customer.id)).size === customers.length;
  }

  function normalizeCustomers(customers) {
    // 구버전 방문 목록 누락은 메모리에서만 보완합니다. 다른 속성은 그대로 보존합니다.
    return customers.map(customer => ({ ...customer, visits: customer.visits === undefined ? [] : customer.visits }));
  }

  function searchCustomers(customers, text) {
    const query = text.trim().toLocaleLowerCase();
    const phoneQuery = digits(query);
    const phoneOnly = /^[\d\s()+-]+$/.test(query);
    return customers.filter(customer => !query || customer.name.toLocaleLowerCase().includes(query) ||
      customer.phone.includes(query) || (phoneOnly && phoneQuery && digits(customer.phone).includes(phoneQuery)))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }

  function sortedVisits(visits) {
    return [...visits].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  function upsertCustomer(customers, id, data) {
    const name = data.name.trim();
    const phone = data.phone.trim();
    if (!name || name.length > 50) throw validationError("이름을 1~50자로 입력해 주세요.", "name");
    if (!/^[\d\s()+-]+$/.test(phone) || digits(phone).length < 8 || digits(phone).length > 15) {
      throw validationError("연락처를 숫자 8~15자리로 입력하세요. 하이픈과 공백도 사용할 수 있습니다.", "phone");
    }
    if (!validDate(data.visit) || data.visit > today()) {
      throw validationError("최초 방문일은 오늘 또는 이전 날짜로 입력해 주세요.", "first-visit");
    }
    if (typeof data.memo !== "string" || data.memo.length > 10000) throw validationError("메모는 10,000자 이내로 입력해 주세요.", "basic-memo");
    const old = customers.find(customer => customer.id === id);
    if (id && !old) throw new Error("고객 정보를 찾지 못했습니다. 새로고침해 주세요.");
    const record = old ? { ...old, ...data, name, phone } : { id: uid("customer"), ...data, name, phone, visits: [] };
    return {
      customer: record,
      customers: old ? customers.map(customer => customer.id === old.id ? record : customer) : [...customers, record]
    };
  }

  function upsertVisit(customers, customerId, visitId, data, activeItems) {
    const customer = customers.find(item => item.id === customerId);
    if (!customer) throw new Error("고객 정보를 찾지 못했습니다.");
    const old = customer.visits.find(visit => visit.id === visitId);
    if (visitId && !old) throw new Error("관리 기록을 찾지 못했습니다.");
    if (!validDate(data.date) || data.date > today()) throw validationError("방문일은 오늘 또는 이전 날짜로 입력해 주세요.", "visit-date");
    if (!data.items.length) throw validationError("관리 항목을 하나 이상 선택해 주세요.", "item-choices");
    const allowed = new Set([...activeItems, ...(old ? old.items : [])]);
    if (!data.items.every(item => allowed.has(item))) throw validationError("관리 항목이 변경되었습니다. 다시 확인해 주세요.", "item-choices");
    if (typeof data.memo !== "string" || data.memo.length > 10000) throw validationError("메모는 10,000자 이내로 입력해 주세요.", "visit-memo");
    // 이름은 저장 당시의 문자열로 보존합니다. 설정을 수정해도 이 기록은 변하지 않습니다.
    const record = { ...(old || { id: uid("visit") }), ...data, items: [...new Set(data.items)] };
    const visits = old ? customer.visits.map(visit => visit.id === old.id ? record : visit) : [...customer.visits, record];
    return customers.map(item => item.id === customer.id ? { ...item, visits } : item);
  }

  function removeVisit(customers, customerId, visitId) {
    return customers.map(customer => customer.id === customerId ?
      { ...customer, visits: customer.visits.filter(visit => visit.id !== visitId) } : customer);
  }

  function removeCustomer(customers, customerId) {
    return customers.filter(customer => customer.id !== customerId);
  }

  function cleanItemName(name) { return name.normalize("NFKC").trim().replace(/\s+/g, " "); }
  function itemKey(name) { return cleanItemName(name).toLocaleLowerCase("ko"); }

  function validItems(items) {
    return Array.isArray(items) && items.every(name => nonemptyString(name) && name.length <= 40) &&
      new Set(items.map(itemKey)).size === items.length;
  }

  function saveItem(items, previousName, input) {
    const name = cleanItemName(input);
    if (!name || name.length > 40) throw validationError("관리 항목 이름을 1~40자로 입력해 주세요.", "item-name");
    if (previousName !== null && !items.includes(previousName)) throw new Error("수정할 항목을 찾지 못했습니다.");
    if (items.some(item => item !== previousName && itemKey(item) === itemKey(name))) {
      throw validationError("같은 이름의 관리 항목이 이미 있습니다.", "item-name");
    }
    return previousName === null ? [...items, name] : items.map(item => item === previousName ? name : item);
  }

  function removeItem(items, name) { return items.filter(item => item !== name); }

  function visitChoices(items, previousItems = []) {
    // 없어진 항목은 해당 기록을 수정할 때만 제공하여 메모 수정 시 누락을 방지합니다.
    return [...items.map(name => ({ name, historical: false })),
      ...[...new Set(previousItems)].filter(name => !items.includes(name)).map(name => ({ name, historical: true }))];
  }

  function sampleCustomers() {
    return [
      { id: "sample-1", name: "가상손님 봄", phone: "010-0000-0001", visit: "2026-11-01", memo: "가상 상담 기록입니다. 보습 관리 상담.", visits: [
        { id: "sample-visit-1", date: "2026-11-01", items: ["보습", "진정"], memo: "테스트용 첫 방문 기록입니다. 보습과 진정 관리를 진행한 것으로 가정합니다." },
        { id: "sample-visit-2", date: "2026-11-03", items: ["보습"], memo: "테스트용 두 번째 방문 기록입니다." }
      ] },
      { id: "sample-2", name: "가상손님 여름", phone: "010-0000-0002", visit: "2026-11-03", memo: "화면 테스트용 가상 정보입니다.", visits: [] }
    ];
  }

  window.CustomerLogic = Object.freeze({
    DEFAULT_ITEMS, today, validCustomers, normalizeCustomers, searchCustomers, sortedVisits,
    upsertCustomer, upsertVisit, removeVisit, removeCustomer,
    validItems, saveItem, removeItem, visitChoices, sampleCustomers
  });
})();
