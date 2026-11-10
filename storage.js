/* localStorage 입출력과 충돌 감지만 담당합니다. DOM·알림·화면 상태를 변경하지 않습니다. */
(function () {
  "use strict";
  const KEYS = Object.freeze({
    customers: "esthetic-cheoeum-customers-v1",
    items: "esthetic-cheoeum-treatment-items-v1",
    backup: "esthetic-cheoeum-customers-v1:before-visits-v2"
  });

  function createRepository() {
    const logic = window.CustomerLogic;
    let customerRaw = null;
    let itemRaw = null;
    let loaded = false;

    function parse(raw, validate, label) {
      const data = JSON.parse(raw);
      if (!validate(data)) throw new Error(`${label} 데이터 형식에 문제가 있습니다.`);
      return data;
    }

    function load() {
      customerRaw = localStorage.getItem(KEYS.customers);
      itemRaw = localStorage.getItem(KEYS.items);
      const customers = customerRaw === null ? null : logic.normalizeCustomers(parse(customerRaw, logic.validCustomers, "고객"));
      const items = itemRaw === null ? [...logic.DEFAULT_ITEMS] : parse(itemRaw, logic.validItems, "관리 항목");
      loaded = true;
      // 읽을 때는 기존 고객·설정 데이터를 다시 쓰지 않습니다.
      return { customers, items };
    }

    function assertUnchanged() {
      if (!loaded) throw new Error("저장 정보를 먼저 불러와야 합니다.");
      if (localStorage.getItem(KEYS.customers) !== customerRaw || localStorage.getItem(KEYS.items) !== itemRaw) {
        const error = new Error("다른 창에서 저장 정보가 변경되었습니다. 입력 내용을 따로 복사한 뒤 새로고침하세요. 덮어쓰기를 막기 위해 저장을 중지했습니다.");
        error.code = "STORAGE_CONFLICT";
        throw error;
      }
    }

    function saveCustomers(customers) {
      if (!logic.validCustomers(customers)) throw new Error("저장할 고객 데이터 형식에 문제가 있습니다.");
      assertUnchanged();
      if (customerRaw !== null && localStorage.getItem(KEYS.backup) === null) {
        localStorage.setItem(KEYS.backup, customerRaw);
      }
      const serialized = JSON.stringify(customers);
      localStorage.setItem(KEYS.customers, serialized);
      customerRaw = serialized;
    }

    function saveItems(items) {
      if (!logic.validItems(items)) throw new Error("저장할 관리 항목 형식에 문제가 있습니다.");
      assertUnchanged();
      const serialized = JSON.stringify(items);
      // 고객 데이터와 과거 기록은 전혀 쓰지 않습니다. 빈 배열도 유효한 설정입니다.
      localStorage.setItem(KEYS.items, serialized);
      itemRaw = serialized;
    }

    function isRelevantChange(key) {
      return key === null || key === KEYS.customers || key === KEYS.items;
    }

    return Object.freeze({ load, saveCustomers, saveItems, isRelevantChange });
  }

  window.AppStorage = Object.freeze({ KEYS, createRepository });
})();
