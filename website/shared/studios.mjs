// Einzige Liste der Studios für Umschalter und Entwurfshinweise; Reihenfolge wie auf der Startseite.
export const studios = [
  {id: 'automaten-studio', name: 'Automaten-Studio', summary: 'Bewegte Figuren mit Kurbel', storage: ['automaten-studio-project-v1']},
  {id: 'baustein-studio', name: 'Baustein-Studio', summary: 'Steckmodelle aus Blöcken', storage: ['baustein-studio-project-v1']},
  {id: 'drehscheiben-studio', name: 'Drehscheiben-Studio', summary: 'Drehschablonen aus SVG', storage: []},
  {id: 'box-studio', name: 'Kästchen-Studio', summary: 'Kisten, Dosen und Deckel', storage: ['box-studio-project-v1']},
  {id: 'klappkarten-studio', name: 'Klappkarten-Studio', summary: 'Pop-up-Karten aus einem Bogen', storage: ['klappkarten-studio-project-v2', 'klappkarten-studio-project-v1']},
  {id: 'zahnrad-studio', name: 'Zahnrad-Studio', summary: 'Zahnradpaare mit Drehprobe', storage: []}
];

// Studios speichern schon das Startbeispiel. Als Entwurf zählt ein Projekt erst,
// wenn es sich nach einer Eingabe der Person verändert hat (siehe werkstatt.mjs).
export const editedKey = studio => `werkstatt-edited:${studio.id}`;

export function hasDraft(studio, storage = globalThis.localStorage) {
  try { return storage?.getItem(editedKey(studio)) === '1' && studio.storage.some(key => storage.getItem(key)); }
  catch { return false; }
}
