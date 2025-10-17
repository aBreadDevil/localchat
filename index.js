// === Firebase Config ===
const firebaseConfig = {

  apiKey: "AIzaSyCk78u2PsPcJOF2I_NiZFJZELjQyU2zKyo",

  authDomain: "localchat-3b6aa.firebaseapp.com",

  databaseURL: "https://localchat-3b6aa-default-rtdb.asia-southeast1.firebasedatabase.app",

  projectId: "localchat-3b6aa",

  storageBucket: "localchat-3b6aa.firebasestorage.app",

  messagingSenderId: "691800862625",

  appId: "1:691800862625:web:7e01b0969d81ec728625e0",

  measurementId: "G-H9TTCX2Y3M"

};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// === DOM Elements ===
const overlay = document.getElementById("loginOverlay");
// removed old auth inputs; use simple start screen input/button
const startUsernameInput = document.getElementById("startUsernameInput");
const startBtn = document.getElementById("startBtn");

const userDisplay = document.getElementById("userDisplay");
const logoutBtn = document.getElementById("logoutBtn");
const msgInput = document.getElementById("msgInput");
const chatHeader = document.getElementById("chatHeader");
const messagesDiv = document.getElementById("messages");

let currentUser = null;
let activeChat = "global"; // global-only
let messagesRef = null;

let replyTarget = null; // { id, username, text }

/* UI refs for reply preview */
const replyPreview = document.getElementById("replyPreview");
const replyToName = document.getElementById("replyToName");
const replyToSnippet = document.getElementById("replyToSnippet");
const cancelReply = document.getElementById("cancelReply");

/* helper: show reply preview */
function setReplyTarget(target) {
  if (!target) return clearReplyTarget();
  replyTarget = target;
  if (replyPreview && replyToName && replyToSnippet) {
    replyToName.textContent = target.username || "Unknown";
    replyToSnippet.textContent = (target.text || "").slice(0, 120);
    replyPreview.classList.remove("hidden");
  }
}

/* clear reply selection */
function clearReplyTarget() {
  replyTarget = null;
  if (replyPreview) replyPreview.classList.add("hidden");
  if (replyToName) replyToName.textContent = "";
  if (replyToSnippet) replyToSnippet.textContent = "";
}

/**
 * Wrap text by inserting newlines so each line is at most maxLen characters.
 * Preserves existing newlines and tries to break on spaces when possible.
 */
function wrapText(text, maxLen = 40) {
  if (!text) return "";
  // Preserve existing newlines, but hard-wrap each paragraph at maxLen characters.
  const lines = String(text).split('\n');
  const out = [];
  for (const line of lines) {
    if (line.length === 0) {
      out.push('');
      continue;
    }
    for (let i = 0; i < line.length; i += maxLen) {
      out.push(line.slice(i, i + maxLen));
    }
  }
  return out.join('\n');
}

/**
 * Clean message text that was accidentally split into single characters
 * either by newlines ("w\nh\na\nt") or spaces ("w h a t").
 * This tries to preserve intentional newlines while repairing obvious corruption.
 */
function cleanMessageText(text) {
  if (!text) return '';
  let s = String(text);

  // 1) Collapse runs of single-character lines separated by newlines into one word.
  const lines = s.split('\n');
  const rebuilt = [];
  let run = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 1) {
      run.push(trimmed);
      continue;
    }
    if (run.length > 0) {
      // if run is suspiciously long, join
      if (run.length >= 2) {
        rebuilt.push(run.join(''));
      } else {
        // keep single-char line as-is
        rebuilt.push(run.join('\n'));
      }
      run = [];
    }
    rebuilt.push(line);
  }
  if (run.length > 0) {
    if (run.length >= 2) rebuilt.push(run.join(''));
    else rebuilt.push(run.join('\n'));
  }
  s = rebuilt.join('\n');

  // 2) Collapse spaced single-letter sequences like "w h a t" into "what"
  // Only collapse sequences of at least 2 letters separated by single spaces.
  s = s.replace(/\b(?:[A-Za-z0-9]\s+){2,}[A-Za-z0-9]\b/g, match => match.replace(/\s+/g, ''));

  // 3) Trim excessive leading/trailing whitespace
  return s.trim();
}

/* wire cancel button */
if (cancelReply) {
  cancelReply.addEventListener("click", (e) => {
    e.preventDefault();
    clearReplyTarget();
  });
}

/* listen to messages for the active chat (include key) */
function listenChat(chatPath) {
  if (messagesRef) messagesRef.off();
  messagesRef = db.ref("messages/" + chatPath);
  messagesRef.on("child_added", (snap) => {
    const m = snap.val();
    m.id = snap.key;
    appendMessage(m);
  });
}

/* create DOM for a single message with reply/embed and reply action */
function createMessageElement(m) {
  const isYou = currentUser && m.from === currentUser.uid;
  const el = document.createElement("div");
  el.className = "msg " + (isYou ? "you" : "other");
  el.dataset.id = m.id || "";

  const inner = document.createElement("div");
  inner.style.display = "flex";
  inner.style.flexDirection = "column";
  inner.style.alignItems = isYou ? "flex-end" : "flex-start";
  inner.style.maxWidth = "100%";

  // username
  const nameEl = document.createElement("span");
  nameEl.className = "msg-username";
  nameEl.textContent = m.username || (isYou ? (currentUser && currentUser.username) || "You" : "Unknown");

  inner.appendChild(nameEl);

  // if this message is a reply to another, render embed above the bubble
  if (m.replyTo && typeof m.replyTo === "object") {
    const embed = document.createElement("div");
    embed.className = "reply-embed";
    embed.textContent = `${m.replyTo.username || "Unknown"} — ${String(m.replyTo.text || "").slice(0, 150)}`;
    inner.appendChild(embed);
  }

  // message bubble
  const textEl = document.createElement("div");
  textEl.className = "msg-text";
  // clean obviously broken messages (single-letter splits) then render
  textEl.textContent = cleanMessageText(m.text || "");
  inner.appendChild(textEl);

  // actions (reply)
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-btn";
  replyBtn.textContent = "Reply";
  replyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // set reply target based on this message
    setReplyTarget({ id: m.id, username: m.username || "Unknown", text: m.text || "" });
    // focus input
    if (msgInput) msgInput.focus();
  });
  actions.appendChild(replyBtn);

  // wrap bubble + actions in a row for alignment
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "flex-end";
  if (isYou) {
    // your messages: actions on left of bubble if right-aligned
    row.appendChild(actions);
    row.appendChild(inner);
  } else {
    // others: bubble then actions on right
    row.appendChild(inner);
    row.appendChild(actions);
  }

  el.appendChild(row);

  return el;
}

/* appendMessage uses createMessageElement and scrolls */
function appendMessage(m) {
  if (!messagesDiv) return;
  const el = createMessageElement(m);
  messagesDiv.appendChild(el);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/* send message: include replyTo info if set */
async function sendMessage() {
  const text = (msgInput.value || "").trim();
  if (!text) return;
  if (!currentUser) {
    alert("Enter a username first.");
    return;
  }

  const payload = {
    from: currentUser.uid,
    username: currentUser.username || "Anonymous",
    text,
    ts: Date.now()
  };

  if (replyTarget) {
    payload.replyTo = {
      id: replyTarget.id,
      username: replyTarget.username,
      text: String(replyTarget.text || "").slice(0, 500) // store a short snippet
    };
  }

  try {
    await db.ref("messages/" + activeChat).push(payload);
    msgInput.value = "";
    clearReplyTarget();
  } catch (err) {
    console.error("sendMessage failed", err);
  }
}

/* SETTINGS DROPDOWN (guarded — HTML may not include inputs)
const settingsBtn = document.getElementById("settingsBtn");
const settingsDropdown = document.getElementById("settingsDropdown");
const newUsernameInput = document.getElementById("newUsername");
const saveUsernameBtn = document.getElementById("saveUsernameBtn");

if (settingsBtn && settingsDropdown) {
  settingsBtn.onclick = () => settingsDropdown.classList.toggle("hidden");
  document.addEventListener("click", (e) => {
    if (!settingsDropdown.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsDropdown.classList.add("hidden");
    }
  });
}
if (saveUsernameBtn && newUsernameInput) {
  saveUsernameBtn.onclick = async () => {
    const newName = newUsernameInput.value.trim();
    if (!newName) return alert("Enter a new username");
    try {
      await db.ref("users/" + currentUser.uid).update({ username: newName });
      currentUser.username = newName;
      alert("Username updated successfully!");
      settingsDropdown.classList.add("hidden");
    } catch (e) {
      console.error(e);
      alert("Failed to update username. Check console for details.");
    }
  };
}

/*
 Remove Firebase Auth flow: instead use a local start-screen username.
 Stored in localStorage under "lc_user" so returning users skip the start screen.
*/
function startAs(username) {
  const uid = "u_" + Math.random().toString(36).slice(2, 10);
  currentUser = { uid, username: username.trim() || "Anonymous" };
  localStorage.setItem("lc_user", JSON.stringify(currentUser));
  // fade overlay
  overlay.classList.add("hidden");
  // start listening
  openChat("global", "Global Chat");
}

// initialize: if a saved user exists, auto-enter; otherwise show overlay
(function initStartScreen() {
  const saved = localStorage.getItem("lc_user");
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      overlay.classList.add("hidden");
      openChat("global", "Global Chat");
    } catch (e) {
      localStorage.removeItem("lc_user");
      overlay.classList.remove("hidden");
    }
  } else {
    overlay.classList.remove("hidden");
  }
})();

// wire start button
if (startBtn && startUsernameInput) {
  startBtn.onclick = () => {
    const name = startUsernameInput.value || "";
    if (!name.trim()) return alert("Please enter a username");
    startAs(name);
  };
  // allow Enter to start
  startUsernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startBtn.click();
  });
}

// make logout return to start screen (no auth sign-out)
if (logoutBtn) {
  logoutBtn.onclick = () => {
    // stop listening
    if (messagesRef) messagesRef.off();
    messagesRef = null;
    // clear messages and reset UI
    if (messagesDiv) messagesDiv.innerHTML = "";
    currentUser = null;
    localStorage.removeItem("lc_user");
    userDisplay.textContent = "";
    // show overlay (remove hidden so CSS transition handles fade-in)
    overlay.classList.remove("hidden");
  };
}

// ensure we can open the global chat and start listening
function openChat(id, name) {
  activeChat = id || "global";
  if (chatHeader) chatHeader.textContent = name || "Global Chat";
  if (messagesDiv) messagesDiv.innerHTML = "";
  listenChat(activeChat);
}

// wire send button (and keep existing Enter-to-send)
const sendBtn = document.getElementById("sendBtn");
if (sendBtn) {
  sendBtn.addEventListener("click", (e) => {
    e.preventDefault();
    sendMessage();
  });
}

// If a user was already restored during init, ensure chat is opened
if (currentUser && !messagesRef) {
  openChat(activeChat, "Global Chat");
}

// make sure sendMessage uses currentUser and listenChat exists
// Enter-to-send for message input (keeps existing behaviour)
if (msgInput) {
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });
}
