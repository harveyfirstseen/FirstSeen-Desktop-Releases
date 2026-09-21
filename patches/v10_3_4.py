from pathlib import Path
import json,subprocess
r=Path(payload_dir)
def edit(p,a,b):
 p=r/p;s=p.read_text();
 if a not in s: raise SystemExit(f'anchor missing {p}')
 p.write_text(s.replace(a,b,1))

a="  ipcMain.handle('clients:list', () => db.prepare('SELECT * FROM clients ORDER BY updated_at DESC').all().map(mapClient));\n"
b=r'''  ipcMain.handle('clients:undo', (_e, raw) => {
    const id=text(raw,100), c=db.prepare('SELECT * FROM clients WHERE id=?').get(id);
    if(!c) throw new Error('Client not found.');
    if(!c.lead_id) throw new Error('This client is not linked to a CRM lead.');
    const lead=db.prepare('SELECT * FROM leads WHERE id=?').get(c.lead_id);
    if(!lead) throw new Error('The linked CRM lead could not be found.');
    const checks=[['website_projects','website project'],['schedule_items','payment or schedule item'],['app_accounts','client login'],['client_invitations','client invitation'],['client_requests','client request'],['client_approvals','client approval'],['client_files','client file'],['client_website_feedback','client feedback'],['sales_deals','sales deal'],['website_handoffs','website handoff']];
    const blockers=[]; for(const [table,label] of checks){try{if(Number(db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE client_id=?`).get(id)?.c||0)>0) blockers.push(label);}catch{}}
    if(blockers.length) throw new Error(`This client already has linked ${blockers.slice(0,3).join(', ')}${blockers.length>3?' and other client work':''}. Remove or unlink that work first so nothing important is orphaned.`);
    const sales=text(lead.sales_stage,40), restoredSales=sales&&sales!=='Won'?sales:'Uncontacted';
    const legacy={Uncontacted:'New',Attempted:'Contacted','Spoke To':'Contacted','Follow Up':'Follow-Up','Meeting Booked':'Contacted','Quote Sent':'Quoted',Lost:'Lost'}[restoredSales]||'New';
    const ts=nowIso(); db.transaction(()=>{db.prepare('DELETE FROM clients WHERE id=?').run(id);db.prepare('UPDATE leads SET stage=?,sales_stage=?,updated_at=? WHERE id=?').run(legacy,restoredSales,ts,lead.id);logLeadEvent(db,lead.id,'Client conversion undone',`Returned to Leads · ${restoredSales}.`,'client','Clients');})();
    return {ok:true,leadId:lead.id,businessName:lead.name,stage:legacy,salesStage:restoredSales};
  });

'''+a
edit(Path('app/src/main/ipc/operations.js'),a,b)
edit(Path('app/src/preload.js'),"    addFromLead: id => ipcRenderer.invoke('clients:add-from-lead', id),\n    list: () => ipcRenderer.invoke('clients:list'),","    addFromLead: id => ipcRenderer.invoke('clients:add-from-lead', id),\n    undo: id => ipcRenderer.invoke('clients:undo', id),\n    list: () => ipcRenderer.invoke('clients:list'),")

p=r/'app/src/renderer/app.js';s=p.read_text()
a='<button class="secondary mini-button" data-hosting-client="${escapeHtml(client.id)}" type="button">Hosting</button></div></article>`'
b='<button class="secondary mini-button" data-hosting-client="${escapeHtml(client.id)}" type="button">Hosting</button><button class="danger-small" data-undo-client="${escapeHtml(client.id)}" type="button">Undo Client</button></div></article>`'
if a not in s: raise SystemExit('client card anchor missing')
s=s.replace(a,b,1)
a="clientList.addEventListener('click', async event => {\n  const seoButton=event.target.closest('[data-seo-client]');"
b=r'''clientList.addEventListener('click', async event => {
  const undo=event.target.closest('[data-undo-client]');
  if(undo){
    const c=clients.find(x=>x.id===undo.dataset.undoClient); if(!c)return;
    if(!confirm(`Undo client for ${c.businessName}?\n\nThis removes the client record and returns the business to Leads. The CRM lead itself is kept.`))return;
    try{const result=await window.firstseen.clients.undo(c.id);clientForm.classList.add('hidden');document.getElementById('clientPortalAdmin')?.classList.add('hidden');await Promise.all([refreshClients(),loadLeads(),refreshDashboard()]);switchView('leadFinder');setMessage(formMessage,`${result.businessName} returned to Leads.`,'success');}catch(error){alert(error.message||'Could not undo this client.');}
    return;
  }
  const seoButton=event.target.closest('[data-seo-client]');'''
if a not in s: raise SystemExit('client click anchor missing')
p.write_text(s.replace(a,b,1))

edit(Path('app/src/renderer/index.html'),'<div><p class="eyebrow">CLIENT HUB</p><h1>Clients</h1><p class="subtext">Won CRM leads become clients. Manage onboarding, package, delivery stage and expected payments here.</p></div>','<div><p class="eyebrow">CLIENT HUB</p><h1>Clients</h1><p class="subtext">Won CRM leads become clients. Manage onboarding, package, delivery stage and expected payments here. Undo Client returns an accidental conversion to Leads without deleting the CRM lead.</p></div>')

pkg=r/'app/package.json';d=json.loads(pkg.read_text());d['version']='10.3.4';d['description']='FirstSeen Digital desktop operating app - V10.3.4 adds Undo Client for accidental Won/client conversions.';pkg.write_text(json.dumps(d,indent=2)+'\n')
for x in ['app/README.md','app/docs/WINDOWS_INSTALLER_V10.md','app/installer/README.md','app/installer/install.ps1','install.ps1','app/src/renderer/index.html','app/src/renderer/app.js']:
 p=r/x
 if p.exists():p.write_text(p.read_text().replace('10.3.3','10.3.4'))
(r/'app/docs/RELEASE_NOTES_V10_3_4.md').write_text('# FirstSeen Desktop V10.3.4\n\n- Adds Undo Client for accidental client conversions.\n- Keeps the original CRM lead and returns it from Won to its prior Sales Mode stage where possible.\n- Blocks undo when linked client work already exists, preventing orphaned projects/payments/logins.\n- Refreshes Clients, Leads and Dashboard and opens Leads immediately after undo.\n')
for x in ['app/src/main/ipc/operations.js','app/src/preload.js','app/src/renderer/app.js']:subprocess.run(['node','--check',str(r/x)],check=True)
print('ok')
