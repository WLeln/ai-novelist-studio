// ---------- ワークスペースバックアップ：全データのJSONエクスポート/復元 ----------
import { $ } from './dom.js';
import { api, appConfirm, appAlert, downloadFile } from './util.js';

const el = (id) => $(id);

async function doExport() {
  const st = el('backupStatus');
  if (st) st.textContent = 'エクスポート中…';
  try {
    const data = await api('/api/backup');
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const name = `ai-novelist-studio-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    downloadFile(name, JSON.stringify(data), 'application/json');
    if (st) st.textContent = `${(data.docs || []).length}件を保存しました`;
  } catch (e) {
    if (st) st.textContent = '失敗: ' + (e.message || e);
  }
}

async function doImportFile(file) {
  const st = el('backupStatus');
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.docs)) throw new Error('バックアップファイルではありません');
    const n = data.docs.length;
    if (!(await appConfirm(`バックアップ（${n}件）を復元します。\n現在のデータはすべて上書きされます。よろしいですか？\n\n※復元後はアプリが再読み込みされます`))) return;
    if (st) st.textContent = '復元中…';
    const r = await api('/api/backup/restore', { method: 'POST', body: JSON.stringify({ docs: data.docs }) });
    if (st) st.textContent = `${r.restored}件を復元しました。再読み込みします…`;
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    if (st) st.textContent = '失敗: ' + (e.message || e);
    appAlert('インポートに失敗しました: ' + (e.message || e));
  }
}

export function openBackup() {
  el('backupModal')?.classList.remove('hidden');
  const st = el('backupStatus');
  if (st) st.textContent = '';
}

export function initBackup() {
  el('miBackup') && (el('miBackup').onclick = openBackup);
  el('btnBackupExport') && (el('btnBackupExport').onclick = doExport);
  el('btnBackupImport') && (el('btnBackupImport').onclick = () => el('backupFile')?.click());
  el('backupFile')?.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) doImportFile(f);
    e.target.value = '';
  });
  el('btnCloseBackup') && (el('btnCloseBackup').onclick = () => el('backupModal').classList.add('hidden'));
  el('backupModal')?.addEventListener('click', (e) => { if (e.target === el('backupModal')) el('backupModal').classList.add('hidden'); });
}
