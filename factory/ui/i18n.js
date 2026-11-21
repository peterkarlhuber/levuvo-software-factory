// Levuvo SF web UI labels in the owner's language (setting human_language; German by default, English otherwise).

const DE = {
  inbox: "Braucht dich", projects: "Projekte", settings: "Einstellungen", newProject: "Neues Projekt",
  nothingWaiting: "Nichts wartet auf dich.", running: "Läuft gerade",
  connectionLost: "Keine Verbindung zur Factory. Läuft sie? (docker compose ps)", loading: "Lädt …",
  kindQuestion: "Frage", kindPaused: "Pausiert", kindReady: "Bereit", kindError: "Fehler", kindDeleting: "Löschen offen",
  answer: "Beantworten", resume: "Fortsetzen", start: "Interview starten", pause: "Pausieren", open: "Öffnen",
  readyText: "Briefing vorhanden, Interview noch nicht gestartet", deletingText: "Löschen wurde nicht abgeschlossen",
  st_idle: "Noch nicht gestartet", st_running: "Agent arbeitet", st_waiting_for_human: "Wartet auf dich",
  st_paused: "Pausiert", st_finished: "Interview abgeschlossen – PRD-Freigabe folgt",
  noProjects: "Noch keine Projekte.", name: "Name", idea: "Deine Idee in ein paar Sätzen",
  ideaHint: "Wird als briefing/idea.md gespeichert. Weitere Dateien kannst du gleich mitgeben oder später hinzufügen.",
  files: "Dateien (optional)", create: "Projekt anlegen", creating: "Wird angelegt …",
  needIdeaOrFile: "Bitte eine Idee eingeben oder eine Datei wählen.",
  waitingQuestion: "Eine Frage wartet auf dich", agentWorking: "Der Agent arbeitet …",
  prd: "PRD-Entwurf", features: "Features", noFeatures: "Noch keine Features.",
  briefing: "Briefing", addFiles: "Dateien hinzufügen", uploading: "Lädt hoch …", remove: "Löschen",
  readable: "lesbar", notReadable: "nicht lesbar", fromAnswer: "Anhang zu", history: "Fragen und Antworten",
  noHistory: "Noch keine Fragen.", runs: "Läufe", cost: "Kosten (Schätzung)", searches: "Suchen",
  properties: "Eigenschaften", webSearch: "Websuche für den Interviewer",
  webSearchNote: "Der Interviewer darf aktuelle Fakten nachschlagen, vor allem Gesetze. Suchanfragen verlassen die Factory (ca. 1 Cent pro Suche). Gilt ab dem nächsten Lauf.",
  deleteProject: "Projekt löschen", deleteTitle: "Projekt endgültig löschen?",
  deleteText: "Löscht das Projekt, sein Briefing, das Interview und sein Repository auf dem Git-Server. Das lässt sich nicht rückgängig machen.",
  typeName: "Zum Bestätigen den Projektnamen eintippen", cancel: "Abbrechen", deleting: "Wird gelöscht …",
  question: "Frage", recommended: "Empfohlen", recommendation: "Empfehlung", ownAnswer: "Eigene Antwort",
  note: "Ergänzung (optional)", yourAnswer: "Deine Antwort", attachments: "Anhänge (optional)", send: "Antwort senden",
  sending: "Wird gesendet …", alreadyAnswered: "Diese Frage ist schon beantwortet.", backToProject: "Zum Projekt",
  needAnswer: "Bitte eine Antwort eingeben oder eine Datei anhängen.", answered: "Antwort",
  language: "Sprache", waitMinutes: "Wartezeit auf deine Antwort (Minuten)", idleMinutes: "Stopp ohne Aktivität (Minuten)",
  maxTurns: "Max. Züge pro Lauf", roles: "Modell und Aufwand pro Rolle", save: "Speichern", saved: "Gespeichert.",
  notFound: "Nicht gefunden.", repo: "Repository", sectionStatus: { open: "offen", drafted: "Entwurf", confirmed: "bestätigt", deferred: "zurückgestellt" },
  reasons: {
    paused_by_human: "Von dir pausiert", paused_wait_timeout: "Keine Antwort innerhalb der Wartezeit",
    idle_timeout: "Agent war zu lange untätig", ended_without_finish: "Lauf endete ohne Abschluss",
    factory_stopped: "Factory wurde gestoppt", factory_restarted: "Factory wurde neu gestartet",
    finish_failed: "Lauf-Ende fehlgeschlagen", failed: "Lauf mit Fehler beendet", start_failed: "Start fehlgeschlagen",
    model_error: "Fehler beim Modell", turn_cap: "Höchstzahl an Zügen erreicht", repeated_failure: "Gleicher Fehler wiederholt",
    channel_tampered: "Werkzeugkanal manipuliert", briefing_changed_after_finish: "Briefing nach Abschluss geändert",
    finished: "Abgeschlossen",
  },
};

const EN = {
  inbox: "Needs you", projects: "Projects", settings: "Settings", newProject: "New project",
  nothingWaiting: "Nothing is waiting for you.", running: "Running now",
  connectionLost: "No connection to the factory. Is it running? (docker compose ps)", loading: "Loading …",
  kindQuestion: "Question", kindPaused: "Paused", kindReady: "Ready", kindError: "Error", kindDeleting: "Deletion open",
  answer: "Answer", resume: "Resume", start: "Start interview", pause: "Pause", open: "Open",
  readyText: "Briefing present, interview not started yet", deletingText: "Deletion was not completed",
  st_idle: "Not started", st_running: "Agent working", st_waiting_for_human: "Waiting for you",
  st_paused: "Paused", st_finished: "Interview finished – PRD approval follows",
  noProjects: "No projects yet.", name: "Name", idea: "Your idea in a few sentences",
  ideaHint: "Stored as briefing/idea.md. You can add more files now or later.",
  files: "Files (optional)", create: "Create project", creating: "Creating …",
  needIdeaOrFile: "Please enter an idea or choose a file.",
  waitingQuestion: "A question is waiting for you", agentWorking: "The agent is working …",
  prd: "PRD draft", features: "Features", noFeatures: "No features yet.",
  briefing: "Briefing", addFiles: "Add files", uploading: "Uploading …", remove: "Delete",
  readable: "readable", notReadable: "not readable", fromAnswer: "Attachment to", history: "Questions and answers",
  noHistory: "No questions yet.", runs: "Runs", cost: "Cost (estimate)", searches: "searches",
  properties: "Properties", webSearch: "Web search for the interviewer",
  webSearchNote: "The interviewer may look up current facts, mainly laws. Search queries leave the factory (about 1 cent per search). Applies from the next run.",
  deleteProject: "Delete project", deleteTitle: "Delete the project for good?",
  deleteText: "Deletes the project, its briefing, the interview and its repository on the git server. This cannot be undone.",
  typeName: "Type the project name to confirm", cancel: "Cancel", deleting: "Deleting …",
  question: "Question", recommended: "Recommended", recommendation: "Recommendation", ownAnswer: "Own answer",
  note: "Note (optional)", yourAnswer: "Your answer", attachments: "Attachments (optional)", send: "Send answer",
  sending: "Sending …", alreadyAnswered: "This question is already answered.", backToProject: "To the project",
  needAnswer: "Please enter an answer or attach a file.", answered: "Answer",
  language: "Language", waitMinutes: "Wait for your answer (minutes)", idleMinutes: "Stop without activity (minutes)",
  maxTurns: "Max. turns per run", roles: "Model and effort per role", save: "Save", saved: "Saved.",
  notFound: "Not found.", repo: "Repository", sectionStatus: { open: "open", drafted: "draft", confirmed: "confirmed", deferred: "deferred" },
  reasons: {
    paused_by_human: "Paused by you", paused_wait_timeout: "No answer within the wait time",
    idle_timeout: "Agent idle for too long", ended_without_finish: "Run ended without finishing",
    factory_stopped: "Factory was stopped", factory_restarted: "Factory was restarted",
    finish_failed: "Run end failed", failed: "Run ended with an error", start_failed: "Start failed",
    model_error: "Model error", turn_cap: "Turn limit reached", repeated_failure: "Same error repeated",
    channel_tampered: "Tool channel tampered with", briefing_changed_after_finish: "Briefing changed after finishing",
    finished: "Finished",
  },
};

let L = DE;
export function setLanguage(lang) {
  L = String(lang ?? "de").slice(0, 2) === "de" ? DE : EN;
  document.documentElement.lang = L === DE ? "de" : "en";
}
export const t = (key) => L[key] ?? key;
export const reason = (r) => (r ? L.reasons[r] ?? r : "");
export const sectionStatus = (s) => L.sectionStatus[s] ?? s;
/** Exit reasons that mean something went wrong (shown as an error in the inbox). */
export const ERROR_REASONS = ["failed", "start_failed", "model_error", "turn_cap", "repeated_failure", "channel_tampered", "finish_failed"];
export const locale = () => (L === DE ? "de-AT" : "en-GB");
