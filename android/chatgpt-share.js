/*
 * 「傳到 ChatGPT 生圖」按鈕（只在 Android app 版本載入）
 *
 * 流程：下載三張原圖 → 拼成一張三聯圖 → 複製提示詞 → 開啟 Android 分享選單，
 * 使用者選 ChatGPT 後，圖片（和提示詞）會帶進新對話。
 * 只送一張圖，是為了省免費版 ChatGPT 每天有限的上傳次數。
 */
(function () {
  "use strict";

  var LABEL = "📤 傳到 ChatGPT 生圖";
  var cap = window.Capacitor;

  function isNative() {
    return !!(cap && typeof cap.nativePromise === "function");
  }

  function call(plugin, method, opts) {
    return cap.nativePromise(plugin, method, opts || {});
  }

  function buildPrompt(x) {
    return [
      "請根據我附上的這張參考圖，直接生成 1 張新圖片，不需要先跟我確認。",
      "",
      "參考圖是一張三聯圖，由左到右：",
      "① 左：臉 —— " + x.f.id + "（" + x.fDesc + "）",
      "② 中：服裝 —— " + x.c.id + "（" + x.cCat + "：" + x.cZh + "）",
      "③ 右：姿勢 —— " + x.p.id + " " + x.p.zh + "（人偶線稿只代表動作）",
      "",
      "要求",
      "1. 三聯圖只是素材：不要照抄這張拼圖，也不要保留分格、邊框和文字標註。",
      "2. 人物的臉只以左格為依據：五官、臉型、骨相、髮型都保持一致，是同一個人。",
      "3. 服裝整套換成中格：保留單品、配色、材質與配件。",
      "4. 姿勢照右格擺放：注意機位與透視，四肢自然、手指正常、不穿模。不要畫出人偶線稿本身。",
      "5. 畫面：3:4 直式構圖，全身入鏡，乾淨背景，柔和棚拍光，寫實攝影質感。",
      "6. 不要出現文字、浮水印或多餘人物。"
    ].join("\n");
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error("圖片載入失敗")); };
      im.src = src;
    });
  }

  // 用原生下載（不受網頁跨網域限制），再用 app 內部網址讀回來畫到畫布上
  function fetchOriginal(url, name) {
    return call("Filesystem", "downloadFile", { url: url, path: name, directory: "CACHE" })
      .then(function (r) { return loadImage(cap.convertFileSrc(r.path) + "?t=" + Date.now()); });
  }

  function drawSheet(panels) {
    var PW = 900, PH = 1200, GAP = 24, PAD = 40, LAB = 100;
    var W = PAD * 2 + PW * 3 + GAP * 2, H = PAD + PH + LAB + PAD;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
    panels.forEach(function (o, k) {
      var ox = PAD + k * (PW + GAP);
      var s = Math.min(PW / o.img.width, PH / o.img.height);
      var w = o.img.width * s, h = o.img.height * s;
      g.drawImage(o.img, ox + (PW - w) / 2, PAD + (PH - h) / 2, w, h);
      g.fillStyle = "#1b1b1f";
      g.font = "600 34px sans-serif";
      g.fillText(o.label, ox, PAD + PH + 46);
      g.fillStyle = "#6b6b76";
      g.font = "26px sans-serif";
      g.fillText(o.sub, ox, PAD + PH + 84);
    });
    return c.toDataURL("image/jpeg", 0.92).split(",")[1];
  }

  function setText(btn, t, resetMs) {
    btn.textContent = t;
    if (resetMs) setTimeout(function () { btn.textContent = LABEL; btn.disabled = false; }, resetMs);
  }

  function run(btn) {
    var api = window.__AIREF;
    if (!api || !api.comboParts) { setText(btn, "這個版本不支援，請重新編譯", 2500); return; }
    var x = api.comboParts();
    var prompt = buildPrompt(x);
    btn.disabled = true;

    if (!isNative()) {
      // 瀏覽器版：只能複製提示詞再開 ChatGPT
      (navigator.clipboard ? navigator.clipboard.writeText(prompt) : Promise.resolve())
        .catch(function () {}).then(function () {
          window.open("https://chatgpt.com/", "_blank");
          setText(btn, "已複製提示詞", 2000);
        });
      return;
    }

    var stamp = Date.now();
    var jobs = [
      { url: x.urls.face, label: "① 臉 · " + x.f.id, sub: x.fDesc },
      { url: x.urls.costume, label: "② 服裝 · " + x.c.id, sub: x.cCat + " · " + x.c.zh.slice(0, 4).join(" ") },
      { url: x.urls.pose, label: "③ 姿勢 · " + x.p.id, sub: x.p.zh }
    ];
    var done = 0;
    setText(btn, "下載原圖中 0/3…");

    Promise.all(jobs.map(function (j, i) {
      return fetchOriginal(j.url, "ref_" + i + "_" + stamp + ".png").then(function (img) {
        done++; setText(btn, "下載原圖中 " + done + "/3…");
        return { img: img, label: j.label, sub: j.sub };
      });
    })).then(function (panels) {
      setText(btn, "拼圖中…");
      var data = drawSheet(panels);
      return call("Filesystem", "writeFile", {
        path: "refs_" + x.f.id + "_" + x.c.id + "_" + x.p.id + ".jpg",
        data: data,
        directory: "CACHE"
      });
    }).then(function (w) {
      return call("Clipboard", "write", { string: prompt }).catch(function () {}).then(function () {
        setText(btn, "已複製提示詞，請選 ChatGPT", 4000);
        return call("Share", "share", { text: prompt, files: [w.uri], dialogTitle: "傳到 ChatGPT" });
      });
    }).catch(function (e) {
      var msg = String((e && e.message) || e);
      if (/cancel/i.test(msg)) { setText(btn, LABEL, 1); return; }
      setText(btn, "失敗：請確認有網路", 3000);
    });
  }

  function inject() {
    var box = document.querySelector("#grid.combo .prompt-btns");
    if (!box || box.querySelector(".chatgpt-share")) return;
    var b = document.createElement("button");
    b.className = "primary chatgpt-share";
    b.textContent = LABEL;
    b.onclick = function () { run(b); };
    box.appendChild(b);
  }

  function start() {
    var grid = document.getElementById("grid");
    if (!grid) return;
    new MutationObserver(inject).observe(grid, { childList: true, subtree: true });
    inject();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
