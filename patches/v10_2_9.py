from pathlib import Path
import json, re, subprocess

root = Path(payload_dir)
appjs = root / "app" / "src" / "browser-crm" / "app.js"
cssp = root / "app" / "src" / "browser-crm" / "app.css"
idx = root / "app" / "src" / "browser-crm" / "index.html"
server = root / "app" / "src" / "main" / "browserCrm.js"

s = appjs.read_text(encoding="utf-8")
old_func = """function callScript(l){
return `Hey, is this ${l.business}? Harvey here from FirstSeen. I found your business online and noticed ${callSpecificReason(l)}. I build websites for local businesses, and I think I could help. I’m just looking to grab 10 minutes with you sometime this week and show you what I mean. Would you be open to that?`;
}
"""
new_func = old_func + """function callScriptLines(l){
return [
`Hey, is this ${l.business}?`,
'Harvey here from FirstSeen.',
`I found your business online and noticed ${callSpecificReason(l)}.`,
'I build websites for local businesses, and I think I could help.',
'I’m just looking to grab 10 minutes with you sometime this week and show you what I mean.',
'Would you be open to that?'
].join('\\n');
}
"""
if old_func not in s:
    raise SystemExit("callScript function not found")
s = s.replace(old_func, new_func, 1)

old_resolve = """  for(const section of resolved.sections){
    section.title=section.title.split('{{business}}').join(business).split('{{reason}}').join(reason).split('{{website_issue}}').join(websiteIssue);
    for(const block of section.blocks)block.text=block.text.split('{{business}}').join(business).split('{{reason}}').join(reason).split('{{website_issue}}').join(websiteIssue);
  }
  return resolved;
}"""
new_resolve = """  for(const section of resolved.sections){
    section.title=section.title.split('{{business}}').join(business).split('{{reason}}').join(reason).split('{{website_issue}}').join(websiteIssue);
    for(const block of section.blocks)block.text=block.text.split('{{business}}').join(business).split('{{reason}}').join(reason).split('{{website_issue}}').join(websiteIssue);
    if(section.title.trim().toUpperCase()==='OPENING'){
      const firstSpeech=section.blocks.find(block=>block.type==='speech');
      if(firstSpeech&&!firstSpeech.text.includes('\\n'))firstSpeech.text=firstSpeech.text.replace(/([.!?])\\s+(?=[A-Z])/g,'$1\\n');
    }
  }
  return resolved;
}"""
if old_resolve not in s:
    raise SystemExit("resolve call-script block not found")
s = s.replace(old_resolve, new_resolve, 1)

start = s.index("function updateCallScriptFooter(message){")
end = s.index("  function scriptSpeech(text)", start)
replacement = r'''function desktopScriptBridgeAvailable(){return connection.mode==='desktop'||(location.protocol==='http:'&&location.hostname==='127.0.0.1');}
function updateCallScriptFooter(message,tone=''){
  const panel=el('callScriptPanel');if(!panel)return;
  const status=panel.querySelector('[data-script-save-status]');
  if(status){status.className='script-save-status '+(tone||'');status.textContent=message||(callScriptDirty?'Unsaved changes':callScriptSaveSource==='prospect'?'Saved for this prospect':callScriptSaveSource==='global'?'Using your saved script for all prospects':'Using the FirstSeen default script');}
  panel.querySelectorAll('.script-save-actions button').forEach(button=>button.disabled=callScriptSaving);
}
async function loadCallScriptForLead(l){
  let raw=null,source='default';const key=callScriptProspectKey(l);let loadedFromDesktop=false;
  if(desktopScriptBridgeAvailable()){
    try{const result=await api('/api/call-script?prospectKey='+encodeURIComponent(key));raw=result.script||null;source=result.source||'default';loadedFromDesktop=true;}
    catch(error){if(connection.mode==='desktop')updateCallScriptFooter('Could not load saved script: '+(error.message||'Desktop error'),'error');}
  }
  if(!loadedFromDesktop){
    const store=standaloneScriptStore();raw=store.callScriptProspects[key]||store.callScriptGlobal||null;source=store.callScriptProspects[key]?'prospect':store.callScriptGlobal?'global':'default';
  }
  const panel=el('callScriptPanel');
  if(raw&&panel){callScriptModel=resolveCallScriptModel(raw,l);applyCallScriptModelToPanel(panel,callScriptModel);}
  else if(panel){callScriptModel=captureCallScriptModel(panel);}
  callScriptSavedModel=cloneCallScript(callScriptModel);callScriptSaveSource=source;callScriptDirty=false;callScriptSaving=false;updateCallScriptFooter();
}
async function persistCallScript(scope,key,script){
  if(desktopScriptBridgeAvailable()){
    const result=await api('/api/call-script',{method:'POST',body:JSON.stringify({scope,prospectKey:key,script})});
    if(!result||result.ok!==true)throw new Error('FirstSeen did not confirm the script was saved.');
    return 'desktop';
  }
  const store=standaloneScriptStore();
  if(scope==='all'){store.callScriptGlobal=script;delete store.callScriptProspects[key];}
  else store.callScriptProspects[key]=script;
  save();
  return 'standalone';
}
async function saveEditedCallScript(scope){
  const l=leadById(callLeadId),panel=el('callScriptPanel');if(!l||!panel||callScriptSaving)return;
  const model=captureCallScriptModel(panel);if(!model){updateCallScriptFooter('Nothing to save.','error');return;}
  const key=callScriptProspectKey(l);callScriptSaving=true;updateCallScriptFooter('Saving…');
  try{
    const payload=scope==='all'?templateizeCallScriptModel(model,l):model;
    await persistCallScript(scope,key,payload);
    callScriptSaveSource=scope==='all'?'global':'prospect';
    callScriptModel=cloneCallScript(model);callScriptSavedModel=cloneCallScript(model);callScriptDirty=false;
    updateCallScriptFooter(scope==='all'?'Saved for all prospects ✓':'Saved for this prospect ✓','success');
  }catch(error){updateCallScriptFooter('Save failed — '+(error.message||'try again'),'error');alert(error.message||'Could not save the call script.');}
  finally{callScriptSaving=false;const panelNow=el('callScriptPanel');if(panelNow)panelNow.querySelectorAll('.script-save-actions button').forEach(button=>button.disabled=false);}
}
function discardEditedCallScript(){
  const panel=el('callScriptPanel');if(panel&&callScriptSavedModel)applyCallScriptModelToPanel(panel,callScriptSavedModel);
  callScriptDirty=false;updateCallScriptFooter("Changes discarded — nothing saved.",'neutral');
}
function bindCallScriptEditor(panel,l){
  if(callScriptModel)applyCallScriptModelToPanel(panel,callScriptModel);else callScriptModel=captureCallScriptModel(panel);
  if(!callScriptSavedModel)callScriptSavedModel=cloneCallScript(callScriptModel);
  panel.insertAdjacentHTML('beforeend',"<div class=\"script-save-bar\"><div class=\"script-save-status\" data-script-save-status></div><div class=\"script-save-actions\"><button type=\"button\" data-script-save-prospect>Save for the prospect</button><button type=\"button\" class=\"save-all\" data-script-save-all>Save for all prospects</button><button type=\"button\" class=\"dont-save\" data-script-dont-save>Don't save</button></div></div>");
  panel.querySelectorAll('[contenteditable=\"true\"]').forEach(node=>node.addEventListener('input',()=>{callScriptDirty=true;updateCallScriptFooter();}));
  const prospectButton=panel.querySelector('[data-script-save-prospect]');
  const allButton=panel.querySelector('[data-script-save-all]');
  const discardButton=panel.querySelector('[data-script-dont-save]');
  prospectButton.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();await saveEditedCallScript('prospect');});
  allButton.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();await saveEditedCallScript('all');});
  discardButton.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();discardEditedCallScript();});
  updateCallScriptFooter();
}
'''
s = s[:start] + replacement + s[end:]

old_open = "${scriptSection('OPENING',scriptSpeech(callScript(l))+scriptAction('Ask the question, then stop talking.','pause'))}"
new_open = "${scriptSection('OPENING',scriptSpeech(callScriptLines(l))+scriptAction('Ask the question, then stop talking.','pause'))}"
if old_open not in s:
    raise SystemExit("opening render not found")
s = s.replace(old_open, new_open, 1)
appjs.write_text(s, encoding="utf-8")

css = cssp.read_text(encoding="utf-8")
extra = """
/* Browser CRM V2.4 — reliable script saving + opening line breaks */
.script-speech{white-space:pre-line}.script-save-bar{position:relative;z-index:3;pointer-events:auto}.script-save-actions button{pointer-events:auto}.script-save-status.success{color:#11613e}.script-save-status.error{color:#a23131}.script-save-status.neutral{color:#667085}
"""
if "Browser CRM V2.4 — reliable script saving" not in css:
    css += extra
cssp.write_text(css, encoding="utf-8")

h = idx.read_text(encoding="utf-8").replace("Browser CRM V2.3","Browser CRM V2.4").replace("<title>FirstSeen CRM V2.3</title>","<title>FirstSeen CRM V2.4</title>")
idx.write_text(h, encoding="utf-8")

pkg = root / "app" / "package.json"
data = json.loads(pkg.read_text(encoding="utf-8"))
data["version"] = "10.2.9"
data["description"] = "FirstSeen Digital desktop operating app - V10.2.9 fixes persistent cold-call script saves and formats the opening script one sentence per line in Browser CRM V2.4."
pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

for p in [
    root/"app"/"README.md", root/"app"/"docs"/"WINDOWS_INSTALLER_V10.md",
    root/"app"/"installer"/"README.md", root/"app"/"installer"/"install.ps1",
    root/"install.ps1", root/"app"/"src"/"renderer"/"index.html", root/"app"/"src"/"renderer"/"app.js"
]:
    if p.exists():
        p.write_text(p.read_text(encoding="utf-8").replace("10.2.8","10.2.9").replace("Browser CRM V2.3","Browser CRM V2.4"), encoding="utf-8")

(root/"app"/"docs"/"RELEASE_NOTES_V10_2_9.md").write_text(
    "# FirstSeen Desktop V10.2.9\n\n"
    "- Browser CRM moves to V2.4.\n"
    "- Fixed the cold-call script save buttons so they use the Desktop API directly when running from FirstSeen Desktop and visibly confirm success or failure.\n"
    "- Save for the prospect persists only for the selected lead.\n"
    "- Save for all prospects persists the edited default template for future leads.\n"
    "- Don't save restores the last saved version and confirms that changes were discarded.\n"
    "- The large opening script now puts every sentence on its own line for easier live reading.\n"
    "- Existing Twilio calling, outcomes, follow-ups, Finder shortlist, SQLite CRM data and updater behaviour are preserved.\n",
    encoding="utf-8"
)

subprocess.run(["node","--check",str(appjs)],check=True)
subprocess.run(["node","--check",str(server)],check=True)
