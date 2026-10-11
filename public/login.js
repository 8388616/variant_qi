(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // 仅返回本站首页或房间，避免查询参数造成跳转到外部网站。
  function returnUrl() {
    try {
      const target = new URL(new URLSearchParams(location.search).get('returnTo') || '/qi', location.origin);
      if (target.origin === location.origin && /^(?:\/|\/qi\/?|\/(?:qi\/)?rooms\/\d+\/?)$/.test(target.pathname)) {
        return target.pathname + target.search + target.hash;
      }
    } catch (_) {}
    return '/qi';
  }
  let action = "login",
    captchaId = "",
    revision = 0;
  async function refresh() {
    const rev = ++revision;
    captchaId = "";
    try {
      const r = await fetch("/qi/auth/captcha?action=" + action, {
        cache: "no-store",
      });
      const data = await r.json();
      if (rev !== revision) return;
      if (!r.ok) throw new Error(data.error);
      captchaId = data.id;
      $("captchaImage").src = data.image;
      $("captchaAnswer").value = "";
    } catch (e) {
      if (rev === revision) $("accountError").textContent = e.message || "无法获取验证码。";
    }
  }
  function select(next) {
    if ($("submitAccount").disabled) return;
    action = next;
    $("loginTab").setAttribute("aria-selected", String(next === "login"));
    $("registerTab").setAttribute("aria-selected", String(next === "register"));
    $("qqField").hidden = next !== "register";
    $("password").autocomplete =
      next === "login" ? "current-password" : "new-password";
    $("submitAccount").textContent = next === "login" ? "登入" : "注册";
    $("accountError").textContent = "";
    void refresh();
  }
  $("loginTab").onclick = () => select("login");
  $("registerTab").onclick = () => select("register");
  $("refreshCaptcha").onclick = refresh;
  $("accountForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = $("submitAccount");
    if (button.disabled) return;
    if (!captchaId) {
      $("accountError").textContent = "请先获取验证码。";
      return;
    }
    button.disabled = true;
    $("accountError").textContent = "";
    try {
      const r = await fetch("/qi/auth/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: $("username").value,
          password: $("password").value,
          qq: $("qq").value,
          captchaId,
          captchaAnswer: $("captchaAnswer").value,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      try { localStorage.setItem('qiAuthChanged', Date.now() + ':' + Math.random()); } catch (_) {}
      location.replace(returnUrl());
    } catch (e) {
      $("accountError").textContent = e.message || "请求失败，请稍后重试。";
      await refresh();
    } finally {
      button.disabled = false;
    }
  };
  void refresh();
})();
