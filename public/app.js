const $ = (s) => document.querySelector(s);
let csrf = "",
  user = null,
  stream = null,
  photo = null,
  busy = false;
const show = (id, on) => ($(id).hidden = !on);
function notify(message, error = false) {
  $("#status").textContent = message;
  $("#status").className = error ? "error" : "";
  show("#status", true);
}
async function api(url, body) {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.message || "Não foi possível concluir.");
  return data;
}
async function action(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    notify(e.message, true);
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("#video").srcObject = null;
}
async function locate() {
  if (!window.isSecureContext)
    throw Error(
      "Localização indisponível: abra a aplicação por HTTPS ou localhost.",
    );
  if (!navigator.geolocation)
    throw Error(
      "Localização indisponível neste navegador. Abra este endereço no Chrome ou Safari fora do editor.",
    );
  const read = (highAccuracy, timeout) =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
          }),
        reject,
        { enableHighAccuracy: highAccuracy, maximumAge: 0, timeout },
      );
    });
  notify("Solicitando uma localização atual. Autorize o acesso no navegador…");
  try {
    try {
      return await read(true, 20000);
    } catch (e) {
      if (e.code !== 2 && e.code !== 3) throw e;
      notify(
        "A primeira leitura não respondeu. Tentando outra leitura atual por até 15 segundos…",
      );
      return await read(false, 15000);
    }
  } catch (e) {
    const help =
      " Abra este endereço no Chrome ou Safari fora do editor e habilite os Serviços de Localização do sistema para esse navegador. Depois tente novamente.";
    throw Error(
      {
        1: "Permissão negada. Autorize a localização nas configurações do navegador e do sistema.",
        2: "Localização indisponível após duas tentativas." + help,
        3: "Tempo esgotado ao obter a localização após duas tentativas." + help,
      }[e.code] || "Localização indisponível." + help,
    );
  }
}
async function camera() {
  stopCamera();
  photo = null;
  show("#preview", false);
  show("#video", true);
  show("#confirm", false);
  show("#retake", false);
  show("#snap", false);
  show("#retry-camera", false);
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error(
        "Câmera indisponível. Use HTTPS ou localhost em um navegador compatível.",
      );
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    $("#video").srcObject = stream;
    await $("#video").play();
    show("#snap", true);
  } catch (e) {
    stopCamera();
    show("#retry-camera", true);
    throw Error(
      e.name === "NotAllowedError"
        ? "Permissão negada para a câmera. Autorize nas configurações do navegador e tente novamente."
        : e.message || "Câmera indisponível.",
    );
  }
}
function records(container, rows, render) {
  container.replaceChildren();
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Nenhum registro encontrado.";
    container.append(p);
  } else rows.forEach((row) => container.append(render(row)));
}
function card(title, detail, badge) {
  const el = document.createElement("article");
  el.className = "record";
  const div = document.createElement("div"),
    strong = document.createElement("strong"),
    small = document.createElement("small");
  strong.textContent = title;
  small.textContent = detail;
  div.append(strong, small);
  el.append(div);
  if (badge) {
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = badge;
    el.append(span);
  }
  return el;
}
function date(v) {
  return v.split("-").reverse().join("/");
}
async function history() {
  const rows = await api("/api/history");
  records($("#history"), rows, (r) =>
    card(`${date(r.local_date)} · ${r.block}`, r.campus, "Presença integral"),
  );
}
async function refresh() {
  const s = await api("/api/session");
  csrf = s.csrf;
  user = s.user;
  show("#demo", s.demonstration);
  show("#welcome", !user);
  show("#dashboard", !!user);
  show("#logout", !!user);
  $("#retention").textContent =
    `Fotos são excluídas após ${s.retention.photosDays} dias; localização inicial e coordenadas de tentativas recusadas após ${s.retention.locationsDays} dias, na rotina horária de retenção.`;
  if (user) {
    show("#capture", false);
    $("#greeting").textContent = `Olá, ${user.name.split(" ")[0]}.`;
    $("#current-block").textContent = s.current.block || "Nenhum bloco ativo";
    $("#current-date").textContent = date(s.current.date);
    $("#campus").textContent = s.campus;
    show("#my-photo", user.hasPhoto);
    await history();
  }
}
$("#login").addEventListener("submit", (e) => {
  e.preventDefault();
  action(async () => {
    await api("/api/login", Object.fromEntries(new FormData(e.target)));
    e.target.reset();
    await refresh();
    notify("Login realizado.");
  });
});
$("#logout").onclick = () =>
  action(async () => {
    stopCamera();
    await api("/api/logout", {});
    await refresh();
    notify("Sessão encerrada.");
  });
$("#register").addEventListener("submit", (e) => {
  e.preventDefault();
  action(async () => {
    const r = await api("/api/register/location", { location: await locate() });
    if (r.code !== "APPROVED")
      return notify(r.message + " Tente novamente.", true);
    show("#welcome", false);
    show("#capture", true);
    show("#retry-geo", false);
    notify("Localização obtida. Autorize a câmera para continuar.");
    await camera();
  });
});
$("#snap").onclick = () => {
  const v = $("#video"),
    c = $("#canvas");
  if (!v.videoWidth) return notify("Aguarde a câmera carregar.", true);
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  photo = c.toDataURL("image/jpeg", 0.85);
  $("#preview").src = photo;
  stopCamera();
  show("#video", false);
  show("#preview", true);
  show("#snap", false);
  show("#retake", true);
  show("#confirm", true);
};
$("#retake").onclick = () => action(camera);
$("#retry-camera").onclick = () => action(camera);
$("#confirm").onclick = () =>
  action(async () => {
    const values = Object.fromEntries(new FormData($("#register")));
    const r = await api("/api/register", { ...values, photo });
    if (r.code === "EXPIRED") {
      show("#retry-geo", true);
      show("#confirm", false);
      return notify(r.message, true);
    }
    stopCamera();
    photo = null;
    $("#preview").removeAttribute("src");
    $("#register").reset();
    await refresh();
    notify("Cadastro concluído. " + r.message);
  });
// Após uma renovação recusada, é necessário capturar outra foto quando a localização voltar a ser aprovada.
$("#retry-geo").onclick = () =>
  action(async () => {
    const r = await api("/api/register/location", { location: await locate() });
    if (r.code === "APPROVED") {
      show("#retry-geo", false);
      if (photo) {
        show("#confirm", true);
        notify("Localização renovada. Confirme para concluir.");
      } else await camera();
    } else {
      stopCamera();
      photo = null;
      $("#preview").removeAttribute("src");
      show("#preview", false);
      show("#confirm", false);
      show("#retake", false);
      show("#retry-camera", false);
      notify(r.message + " Tente novamente.", true);
    }
  });
$("#cancel").onclick = () => {
  stopCamera();
  photo = null;
  $("#preview").removeAttribute("src");
  $("#register").reset();
  show("#capture", false);
  show("#welcome", true);
  notify("Cadastro cancelado.");
};
$("#attend").onclick = () =>
  action(async () => {
    const r = await api("/api/attendance", { location: await locate() });
    await refresh();
    notify(
      r.message,
      ["OUTSIDE", "IMPRECISE", "INVALID_LOCATION"].includes(r.code),
    );
  });
async function openPhoto(id) {
  const res = await fetch("/api/photos/" + id);
  if (!res.ok) throw Error("Foto indisponível.");
  const image = $("#private-photo");
  if (image.dataset.url) URL.revokeObjectURL(image.dataset.url);
  image.dataset.url = URL.createObjectURL(await res.blob());
  image.src = image.dataset.url;
  $("#photo-dialog").showModal();
}
$("#my-photo").onclick = () => action(() => openPhoto(user.id));
$("#close-photo").onclick = () => $("#photo-dialog").close();
$("#photo-dialog").addEventListener("close", () => {
  const im = $("#private-photo");
  URL.revokeObjectURL(im.dataset.url);
  im.removeAttribute("src");
  delete im.dataset.url;
});
window.addEventListener("pagehide", stopCamera);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stream) {
    stopCamera();
    show("#snap", false);
    show("#retry-camera", true);
  }
});
setInterval(async () => {
  if (!user || busy || document.hidden) return;
  try {
    const s = await api("/api/session");
    $("#current-block").textContent = s.current.block || "Nenhum bloco ativo";
    $("#current-date").textContent = date(s.current.date);
  } catch {}
}, 30000);
refresh().catch((e) => notify(e.message, true));
