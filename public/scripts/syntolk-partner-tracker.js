(function () {
  "use strict";
  var current = new URL(window.location.href);
  var code = current.searchParams.get("ref");
  var passedClick = current.searchParams.get("click_id");
  var script = document.currentScript;
  var apiBase = script && script.dataset && script.dataset.apiBase ? script.dataset.apiBase.replace(/\/$/, "") : "";
  var key = "syntolk_partner_click";

  function setClick(id, days) {
    try { localStorage.setItem(key, id); } catch (_) {}
    document.cookie = key + "=" + encodeURIComponent(id) + ";path=/;max-age=" + String((days || 60) * 86400) + ";SameSite=Lax";
  }
  function getClick() {
    if (passedClick) return passedClick;
    try { var v = localStorage.getItem(key); if (v) return v; } catch (_) {}
    var m = document.cookie.match(new RegExp("(?:^|; )" + key + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  if (passedClick) setClick(passedClick, 60);

  if (code && !passedClick) {
    fetch(apiBase + "/api/referrals/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: code,
        landingUrl: window.location.href,
        referer: document.referrer || null,
        source: current.searchParams.get("utm_source"),
        medium: current.searchParams.get("utm_medium"),
        campaign: current.searchParams.get("utm_campaign"),
        content: current.searchParams.get("utm_content"),
        term: current.searchParams.get("utm_term")
      }),
      credentials: "include"
    }).then(function(r){ return r.ok ? r.json() : null; }).then(function(data){
      if (data && data.clickId) setClick(data.clickId, data.expiresInDays || 60);
    }).catch(function(){});
  }

  window.SyntolkPartners = Object.freeze({
    getClickId: getClick,
    referralCode: code
  });
})();