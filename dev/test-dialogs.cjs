// Test helper, loaded with `electron --require dev/test-dialogs.cjs`: the native open and save dialogs cannot be answered by a
// script, so they answer from a queue kept in the JSON file named by TF_DIALOG_ANSWERS (each call takes the first answer;
// an empty queue means "cancelled"). Only the end-to-end scripts use it; the app itself does not know about it.
const fs = require('fs');
const { dialog } = require('electron');
const file = process.env.TF_DIALOG_ANSWERS;
const next = async () => {
  if (!file) return { canceled: true };
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no queue yet */ }
  const answer = list.shift();
  fs.writeFileSync(file, JSON.stringify(list));
  return answer || { canceled: true };
};
dialog.showOpenDialog = next;
dialog.showSaveDialog = next;
