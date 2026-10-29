/* 页面只通过宿主桥接调用声明动作，不持有登录凭据。 */
(() => {
  const sdk = window.NeoBotPlugin;
  const $ = (id) => document.getElementById(id);
  const fallbackError = "操作暂时未完成，请稍后重试。";
  let context;
  let pending = false;
  let preview;
  let previewKey = "";
  let originalSize = false;
  let groups = [];
  let items = [];
  let latestStep;
  let initialized = false;
  let refreshTimer;
  let reportedHealthError = "";
  let reportedBackgroundError = "";
  const disposers = [];
  const selection = () => ({
    group_id: Number($("group_id").value),
    target: $("target-input").value.trim(),
  });
  const key = () => JSON.stringify(selection());
  const canManage = () =>
    context?.available &&
    !context.suspended &&
    context.permissions.includes("manage");

  function updateControls() {
    const available = !!context?.available && !context.suspended;
    document.querySelectorAll("button,input,select").forEach((node) => {
      node.disabled = pending || !available;
    });
    $("subscribe").disabled = pending || !canManage() || previewKey !== key();
    document.querySelectorAll("[data-manage]").forEach((node) => {
      node.disabled = pending || !canManage();
    });
    if (!context?.available) $("health").textContent = "插件未运行";
  }

  function showError(error) {
    // 进入演示时宿主会暂停隐藏页面，这是预期的请求中断。
    if (error.code === "view_suspended") return;
    sdk.notify({
      title: "操作未完成",
      message: error.message || fallbackError,
      tone: "err",
    });
  }

  async function run(task, background = false) {
    if (pending) return;
    // 后台读取不能临时禁用正在操作的控件，否则浏览器会移走焦点。
    const focusedControl = document.hasFocus() &&
      document.activeElement?.matches("input,select,textarea,button,[contenteditable='true']");
    if (background && focusedControl) return;
    pending = true;
    updateControls();
    try {
      await task();
    } catch (error) {
      const message = error.message || fallbackError;
      if (!background || message !== reportedBackgroundError) showError(error);
      if (background) reportedBackgroundError = message;
    } finally {
      pending = false;
      updateControls();
    }
  }

  async function action(name, values = {}) {
    return sdk.action("subscriptions." + name, values);
  }

  function requireSelection() {
    const value = selection();
    if (!value.group_id) throw new Error("先选择接收通知的群。");
    if (!value.target) throw new Error("粘贴直播间链接或输入房间号。");
    return value;
  }

  function invalidate() {
    preview = undefined;
    previewKey = "";
    $("identity").textContent = "房间号、短号和 uid: 写法也可以。";
    $("confirmation").hidden = true;
    $("preview-empty").hidden = false;
    $("preview-canvas").hidden = true;
    $("preview-style").textContent = "未预览";
    $("preview-zoom").hidden = true;
    updateControls();
  }

  async function loadGroups() {
    const result = await action("groups");
    groups = result.items;
    const current = $("group_id").value;
    $("group_id").replaceChildren(new Option("请选择接收群", ""));
    groups.forEach((group) =>
      $("group_id").add(new Option(group.name, String(group.group_id))),
    );
    if (groups.some((group) => String(group.group_id) === current))
      $("group_id").value = current;
    $("group-hint").hidden = groups.length > 0;
    $("group-hint").textContent = "机器人尚未加入群，加群后刷新。";
  }

  function showTarget(target) {
    $("identity").textContent =
      `${target.name || "未命名主播"} · 房间 ${target.room_id}`;
  }

  function sizePreview() {
    if (!preview) return;
    const scale = originalSize
      ? 1
      : Math.min(
          1,
          $("preview-canvas").clientWidth / 720,
          $("preview-canvas").clientHeight / 900,
        );
    $("card").style.transform = `scale(${scale})`;
    $("preview-stage").style.width = `${Math.ceil(720 * scale)}px`;
    $("preview-stage").style.height = `${Math.ceil(900 * scale)}px`;
    $("preview-zoom").textContent = originalSize ? "适应宽度" : "查看原始大小";
  }

  function showPreview(result) {
    preview = result;
    previewKey = key();
    $("card").srcdoc = result.html;
    $("preview-empty").hidden = true;
    $("preview-canvas").hidden = false;
    $("preview-style").textContent = "实际通知模板";
    $("preview-zoom").hidden = false;
    showTarget(result.target);
    const group = groups.find((item) => item.group_id === selection().group_id);
    $("confirmation").textContent =
      `将通知发到「${group?.name || selection().group_id}」，监听「${result.target.name}」。`;
    $("confirmation").hidden = false;
    sizePreview();
  }

  function showHealth(health) {
    let status;
    if (health.error) status = "检查异常";
    else if (!health.running) status = "轮询未运行";
    else if (!health.subscriptions) status = "暂无订阅";
    else if (!health.checked_at) status = "等待首次检查";
    else status = "监听中";
    $("health").textContent = status;
    const checked = health.checked_at
      ? new Date(health.checked_at).toLocaleTimeString()
      : "尚未检查";
    $("checked").textContent =
      `${health.subscriptions} 条订阅 · 最近检查 ${checked}`;
    // 后台轮询只在出现新错误时提示，避免每次刷新重复打扰。
    if (health.error && health.error !== reportedHealthError)
      sdk.notify({
        title: "直播间检查未完成",
        message: health.error,
        tone: "warn",
      });
    reportedHealthError = health.error;
  }

  async function toggleSubscription(row, field, next) {
    const result = await action("toggle", {
      group_id: row.group_id,
      room_id: row.room_id,
      push_live: field === "push_live" ? next : row.push_live,
      push_live_end: field === "push_live_end" ? next : row.push_live_end,
    });
    Object.assign(row, result.item);
    sdk.notify({ title: "推送开关已更新", tone: "ok" });
  }

  function switchBox(row, field, title) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = row[field];
    input.dataset.manage = "";
    input.setAttribute("aria-label", `${row.name} ${title}`);
    input.addEventListener("change", () => {
      const next = input.checked;
      void run(() => toggleSubscription(row, field, next)).finally(renderRows);
    });
    return input;
  }

  async function removeSubscription(item) {
    const result = await action("remove", {
      group_id: item.group_id,
      room_id: item.room_id,
    });
    if (!result.removed) throw new Error("这条订阅已不存在，请刷新列表。");
    items = items.filter((value) => value !== item);
    renderRows();
    if (context.mode !== "demo") await refresh();
    sdk.notify({ title: "已取消监听", tone: "ok" });
  }

  function subscriptionRow(item) {
    const row = document.createElement("tr");
    const group = groups.find((value) => value.group_id === item.group_id);
    for (const text of [
      item.name || `房间 ${item.room_id}`,
      group?.name || String(item.group_id),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    for (const [field, title] of [
      ["push_live", "开播通知"],
      ["push_live_end", "下播通知"],
    ]) {
      const cell = document.createElement("td");
      cell.append(switchBox(item, field, title));
      row.append(cell);
    }
    const cell = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "nb-quiet nb-danger";
    remove.dataset.manage = "";
    remove.textContent = "取消监听";
    remove.setAttribute("aria-label", `取消监听 ${item.name}`);
    remove.addEventListener(
      "click",
      () => void run(() => removeSubscription(item)),
    );
    cell.append(remove);
    row.append(cell);
    return row;
  }

  function renderRows() {
    $("rows")
      .querySelector("tbody")
      .replaceChildren(...items.map(subscriptionRow));
    $("rows").hidden = !items.length;
    $("list-empty").hidden = !!items.length;
    updateControls();
  }

  async function refresh() {
    items = (await action("list")).items;
    renderRows();
    showHealth(await action("health"));
    reportedBackgroundError = "";
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (
      !initialized ||
      context.mode !== "live" ||
      !context.available ||
      context.suspended
    )
      return;
    refreshTimer = setTimeout(async () => {
      if (!pending) await run(refresh, true);
      scheduleRefresh();
    }, 5000);
  }

  async function playExample(step) {
    if (step.mode !== "demo" || !step.target.startsWith("view.subscriptions."))
      return;
    const target = step.target.split(".").slice(2).join(".");
    const example = step.example || {};
    if (example.group_id) $("group_id").value = String(example.group_id);
    if (example.target) $("target-input").value = example.target;
    if (target === "target")
      showTarget(await action("resolve", { target: selection().target }));
    if (target === "preview")
      showPreview(await action("preview", requireSelection()));
    if (target === "start" || target === "status") {
      // 演示只展示合成记录，绝不在教程回调里执行创建、开关或删除动作。
      const result = await action("health");
      items = [
        {
          group_id: 20001,
          room_id: 610001,
          name: "演示主播",
          push_live: true,
          push_live_end: true,
        },
      ];
      renderRows();
      showHealth(result);
    }
    updateControls();
  }

  function updateContext(next) {
    const resume = context.suspended && !next.suspended;
    context = next;
    updateControls();
    if (resume && next.available && next.mode === "live") void run(refresh, true);
    scheduleRefresh();
  }

  function updateGuideStep(step) {
    latestStep = step;
    if (initialized) void playExample(step).catch(showError);
  }

  async function resolveTarget() {
    const value = requireSelection();
    showTarget(await action("resolve", { target: value.target }));
  }

  async function previewSelection() {
    showPreview(await action("preview", requireSelection()));
  }

  async function subscribeSelection() {
    if (previewKey !== key())
      throw new Error("接收群或链接已变化，请重新预览。");
    const result = await action("create", requireSelection());
    if (context.mode === "demo") {
      items = [result.item];
      renderRows();
      showHealth(await action("health"));
    } else {
      await refresh();
    }
    sdk.notify({
      title: result.created ? "已开始监听" : "已更新监听信息",
      tone: "ok",
    });
  }

  async function loadInitialData() {
    await loadGroups();
    if (context.mode !== "demo") await refresh();
  }

  async function start() {
    context = await sdk.ready();
    for (const id of ["group", "target", "preview", "start", "status"]) {
      disposers.push(sdk.registerAnchor(id, $(id)));
    }
    disposers.push(sdk.onContext(updateContext));
    disposers.push(sdk.onGuideStep(updateGuideStep));
    $("group_id").addEventListener("change", invalidate);
    $("target-input").addEventListener("input", invalidate);
    $("reload-groups").addEventListener("click", () => void run(loadGroups));
    $("resolve").addEventListener("click", () => void run(resolveTarget));
    $("show-preview").addEventListener(
      "click",
      () => void run(previewSelection),
    );
    $("preview-zoom").addEventListener("click", () => {
      originalSize = !originalSize;
      sizePreview();
    });
    $("subscribe").addEventListener(
      "click",
      () => void run(subscribeSelection),
    );
    $("refresh").addEventListener("click", () => void run(refresh));
    const observer = new ResizeObserver(sizePreview);
    observer.observe($("preview-canvas"));
    disposers.push(() => observer.disconnect());
    updateControls();
    if (context.available) await run(loadInitialData);
    initialized = true;
    if (latestStep) await playExample(latestStep);
    disposers.push(() => clearTimeout(refreshTimer));
    scheduleRefresh();
  }

  window.addEventListener(
    "pagehide",
    () => disposers.forEach((dispose) => dispose()),
    { once: true },
  );
  void start().catch(showError);
})();
