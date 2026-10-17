(() => {
  "use strict";

  const sections = [...document.querySelectorAll("main section")];
  const nav = document.getElementById("navItems");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const content = document.getElementById("content");
  const liveStatus = document.getElementById("liveStatus");
  const state = { current: 0, role: "", visited: new Set([0]), api: null, initialized: false };

  function findApi(win) {
    for (let tries = 0; win && tries < 10; tries += 1) {
      try { if (win.API) return win.API; if (win.parent === win) break; win = win.parent; } catch (_) { break; }
    }
    try { return window.opener && window.opener.API ? window.opener.API : null; } catch (_) { return null; }
  }

  function scormInit() {
    state.api = findApi(window);
    if (!state.api || state.api.LMSInitialize("") !== "true") return;
    state.initialized = true;
    const status = state.api.LMSGetValue("cmi.core.lesson_status");
    if (!status || status === "not attempted") state.api.LMSSetValue("cmi.core.lesson_status", "incomplete");
    const bookmark = Number(state.api.LMSGetValue("cmi.core.lesson_location"));
    if (Number.isInteger(bookmark) && bookmark >= 0 && bookmark < sections.length) state.current = bookmark;
  }

  function scormSet(name, value) {
    if (state.initialized) state.api.LMSSetValue(name, String(value));
  }

  function commit() { if (state.initialized) state.api.LMSCommit(""); }

  function renderNav() {
    nav.innerHTML = "";
    sections.forEach((section, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${index + 1}. ${section.dataset.title}`;
      button.className = index === state.current ? "active" : "";
      button.setAttribute("aria-current", index === state.current ? "step" : "false");
      button.addEventListener("click", () => show(index));
      nav.appendChild(button);
    });
  }

  function show(index, focus = true) {
    state.current = Math.max(0, Math.min(index, sections.length - 1));
    state.visited.add(state.current);
    sections.forEach((section, i) => { section.hidden = i !== state.current; });
    renderNav();
    document.getElementById("backButton").hidden = state.current === 0;
    document.getElementById("nextButton").hidden = state.current === sections.length - 1;
    progressText.textContent = `${state.current + 1}/${sections.length}`;
    progressBar.style.width = `${((state.current + 1) / sections.length) * 100}%`;
    scormSet("cmi.core.lesson_location", state.current);
    commit();
    try { localStorage.setItem("ilias-school-module-page", state.current); } catch (_) {}
    liveStatus.textContent = `Kapitel ${state.current + 1}: ${sections[state.current].dataset.title}`;
    if (focus) { content.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  }

  function selectRole(role) {
    state.role = role;
    document.querySelectorAll("[data-role-select]").forEach(button => {
      const selected = button.dataset.roleSelect === role;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected);
    });
    document.querySelectorAll("[data-role]").forEach(element => element.classList.toggle("show", element.dataset.role === role));
    const names = { leitung: "Schulleitung", lehrkraft: "Lehrkraft", admin: "Administration" };
    document.getElementById("roleHint").textContent = `Perspektive gewählt: ${names[role]}. Der gemeinsame Inhalt bleibt gleich; passende Zusatzhinweise werden eingeblendet.`;
    try { localStorage.setItem("ilias-school-module-role", role); } catch (_) {}
  }

  document.querySelectorAll("[data-role-select]").forEach(button => button.addEventListener("click", () => selectRole(button.dataset.roleSelect)));
  document.getElementById("backButton").addEventListener("click", () => show(state.current - 1));
  document.getElementById("nextButton").addEventListener("click", () => show(state.current + 1));

  document.getElementById("decisionForm").addEventListener("submit", event => {
    event.preventDefault();
    const needs = new Set(new FormData(event.currentTarget).getAll("need"));
    let text;
    if (!needs.size) text = "Noch keine belastbare Empfehlung: Klären Sie zuerst die gewünschten Schulabläufe.";
    else if (needs.has("lms") || needs.has("tests") || needs.has("rights")) {
      text = "Ein vollständiges LMS ist sinnvoll. ILIAS passt besonders gut bei Tests, Lernpfaden und feinen Rechten; Moodle sollte als Alternative mit größerem Ökosystem geprüft werden.";
      if (needs.has("office")) text += " Ergänzen Sie bei Bedarf Nextcloud für gemeinsame Dokumente und Datei-Synchronisation.";
      if (!needs.has("ops")) text += " Vor einer Einführung muss jedoch die dauerhafte Betriebsverantwortung geklärt werden.";
    } else text = "Wenn Dateien und gemeinsame Dokumente im Mittelpunkt stehen, kann Nextcloud ohne zusätzliches LMS ausreichen.";
    const result = document.getElementById("decisionResult");
    result.textContent = text;
    result.hidden = false;
  });

  document.getElementById("quizForm").addEventListener("submit", event => {
    event.preventDefault();
    const questions = [...event.currentTarget.querySelectorAll(".question")];
    let correct = 0;
    questions.forEach(question => {
      const checked = question.querySelector("input:checked");
      const isCorrect = checked && checked.value === question.dataset.correct;
      correct += isCorrect ? 1 : 0;
      question.classList.toggle("correct", isCorrect);
      question.classList.toggle("wrong", !isCorrect);
    });
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= 75;
    const result = document.getElementById("quizResult");
    result.innerHTML = `<div class="score">${correct} von ${questions.length} richtig (${score} %)</div><p>${passed ? "Bestanden. Sie können die Eignung von ILIAS nun anhand der wichtigsten Kriterien beurteilen." : "Noch nicht bestanden. Sehen Sie sich die markierten Fragen und die passenden Kapitel noch einmal an."}</p>`;
    result.hidden = false;
    scormSet("cmi.core.score.min", 0);
    scormSet("cmi.core.score.max", 100);
    scormSet("cmi.core.score.raw", score);
    scormSet("cmi.core.lesson_status", passed ? "passed" : "failed");
    commit();
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  scormInit();
  try {
    if (!state.current) state.current = Number(localStorage.getItem("ilias-school-module-page")) || 0;
    const role = localStorage.getItem("ilias-school-module-role");
    if (role) selectRole(role);
  } catch (_) {}
  show(state.current, false);

  window.addEventListener("pagehide", () => {
    if (state.initialized) { state.api.LMSCommit(""); state.api.LMSFinish(""); }
  });
})();
