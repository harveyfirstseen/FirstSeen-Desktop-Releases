from pathlib import Path
import json, subprocess

root = Path(payload_dir)
appjs = root / "app" / "src" / "browser-crm" / "app.js"
cssp = root / "app" / "src" / "browser-crm" / "app.css"
idx = root / "app" / "src" / "browser-crm" / "index.html"
server = root / "app" / "src" / "main" / "browserCrm.js"

s = appjs.read_text(encoding="utf-8")

state_old = "  let callLeadId = null;\n  let callStart = null;"
state_new = "  let callLeadId = null;\n  let scriptLeadId = null;\n  let callStart = null;"
if state_old not in s:
    raise SystemExit("Could not add scriptLeadId state")
s = s.replace(state_old, state_new, 1)

open_old = "  function openLead(id){activeLeadId=id;drawerTab='overview';renderDrawer();}"
open_new = """  async function showCallScriptForLead(id){
    const l=leadById(id);if(!l)return;
    scriptLeadId=id;callScriptPanelOpen=true;callScriptModel=null;callScriptSavedModel=null;callScriptSaveSource='default';callScriptDirty=false;
    renderCallScriptPanel();
    await loadCallScriptForLead(l);
  }
  async function openLead(id){
    const scriptChanged=scriptLeadId!==id;
    activeLeadId=id;drawerTab='overview';renderDrawer();
    if(scriptChanged||!callScriptPanelOpen)await showCallScriptForLead(id);
    else renderCallScriptPanel();
  }"""
if open_old not in s:
    raise SystemExit("Could not patch openLead")
s = s.replace(open_old, open_new, 1)

panel_old = "const l=leadById(callLeadId);"
panel_new = "const l=leadById(scriptLeadId||callLeadId);"
panel_count = s.count(panel_old)
if panel_count < 1:
    raise SystemExit("Could not patch script panel lead lookup")
# Replace only the lookup inside renderCallScriptPanel; this is the first occurrence after its function marker.
panel_pos = s.index("function renderCallScriptPanel(){")
lookup_pos = s.index(panel_old, panel_pos)
s = s[:lookup_pos] + panel_new + s[lookup_pos+len(panel_old):]

save_old = "const l=leadById(callLeadId),panel=el('callScriptPanel');if(!l||!panel||callScriptSaving)return;"
save_new = "const l=leadById(scriptLeadId||callLeadId),panel=el('callScriptPanel');if(!l||!panel||callScriptSaving)return;"
if save_old not in s:
    raise SystemExit("Could not patch save lead lookup")
s = s.replace(save_old, save_new, 1)

start_old = "callLeadId=id;callStart=null;clearInterval(callTimer);callTimer=null;voice.error='';voice.state=connection.twilio?'starting':'idle';callScriptPanelOpen=true;callScriptModel=null;callScriptSavedModel=null;callScriptSaveSource='default';callScriptDirty=false;openLead(id);renderDrawer();renderCallScriptPanel();await loadCallScriptForLead(l);"
start_new = "callLeadId=id;callStart=null;clearInterval(callTimer);callTimer=null;voice.error='';voice.state=connection.twilio?'starting':'idle';if(activeLeadId!==id){await openLead(id);}else{renderDrawer();if(scriptLeadId!==id||!callScriptPanelOpen)await showCallScriptForLead(id);else renderCallScriptPanel();}"
if start_old not in s:
    raise SystemExit("Could not patch startCall")
s = s.replace(start_old, start_new, 1)

close_old = "  function closeDrawer(){activeLeadId=null;el('leadDrawer').classList.add('hidden');el('drawerBackdrop').classList.add('hidden');}"
close_new = "  function closeDrawer(){activeLeadId=null;el('leadDrawer').classList.add('hidden');el('drawerBackdrop').classList.add('hidden');if(!callLeadId){scriptLeadId=null;callScriptPanelOpen=false;callScriptModel=null;callScriptSavedModel=null;callScriptSaveSource='default';callScriptDirty=false;renderCallScriptPanel();}}"
if close_old not in s:
    raise SystemExit("Could not patch closeDrawer")
s = s.replace(close_old, close_new, 1)

finish_old = "clearInterval(callTimer);callTimer=null;callLeadId=null;callStart=null;callScriptPanelOpen=false;callScriptModel=null;callScriptSavedModel=null;callScriptSaveSource='default';callScriptDirty=false;voice.call=null;voice.state='idle';voice.error='';voice.muted=false;voice.keypad=false;renderCallScriptPanel();render();if(activeLeadId)renderDrawer();"
finish_new = "clearInterval(callTimer);callTimer=null;callLeadId=null;callStart=null;voice.call=null;voice.state='idle';voice.error='';voice.muted=false;voice.keypad=false;if(activeLeadId){scriptLeadId=activeLeadId;callScriptPanelOpen=true;}else{scriptLeadId=null;callScriptPanelOpen=false;}renderCallScriptPanel();render();if(activeLeadId)renderDrawer();"
if finish_old not in s:
    raise SystemExit("Could not keep script open after call")
s = s.replace(finish_old, finish_new, 1)

appjs.write_text(s, encoding="utf-8")

css = cssp.read_text(encoding="utf-8")
extra = """
/* Browser CRM V2.6 — script available before dialling */
.script-panel-head:after{content:'Ready before you call';display:block;font-size:9px;font-weight:800;color:#667085;letter-spacing:.04em;text-transform:uppercase;margin-left:auto;align-self:center}
"""
if "Browser CRM V2.6 — script available before dialling" not in css:
    css += extra
cssp.write_text(css, encoding="utf-8")

h = idx.read_text(encoding="utf-8").replace("Browser CRM V2.5","Browser CRM V2.6").replace("<title>FirstSeen CRM V2.5</title>","<title>FirstSeen CRM V2.6</title>")
idx.write_text(h, encoding="utf-8")

pkg = root / "app" / "package.json"
data = json.loads(pkg.read_text(encoding="utf-8"))
data["version"] = "10.2.11"
data["description"] = "FirstSeen Digital desktop operating app - V10.2.11 opens the cold-call script as soon as a prospect is selected, before dialling, in Browser CRM V2.6."
pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

for p in [
    root/"app"/"README.md", root/"app"/"docs"/"WINDOWS_INSTALLER_V10.md",
    root/"app"/"installer"/"README.md", root/"app"/"installer"/"install.ps1",
    root/"install.ps1", root/"app"/"src"/"renderer"/"index.html", root/"app"/"src"/"renderer"/"app.js"
]:
    if p.exists():
        p.write_text(p.read_text(encoding="utf-8").replace("10.2.10","10.2.11").replace("Browser CRM V2.5","Browser CRM V2.6"), encoding="utf-8")

(root/"app"/"docs"/"RELEASE_NOTES_V10_2_11.md").write_text(
    "# FirstSeen Desktop V10.2.11\n\n"
    "- Browser CRM moves to V2.6.\n"
    "- Clicking/opening a prospect now opens the cold-call script immediately, at the same time as the prospect drawer and Call button.\n"
    "- You can read or edit the script before dialling.\n"
    "- Pressing Call on an already-open prospect keeps the current script and any unsaved edits in place instead of reloading it.\n"
    "- If a call finishes while the prospect is still open, the script stays available.\n"
    "- Closing the prospect drawer closes the pre-call script when no call is active.\n"
    "- Existing Twilio calling, script editing/saving, outcomes, follow-ups, Finder shortlist, SQLite CRM data and updater behaviour are preserved.\n",
    encoding="utf-8"
)

subprocess.run(["node","--check",str(appjs)],check=True)
subprocess.run(["node","--check",str(server)],check=True)
