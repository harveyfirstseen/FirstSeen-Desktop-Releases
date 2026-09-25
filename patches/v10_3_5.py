from pathlib import Path
import json, subprocess

root = Path(payload_dir)

def replace_once(path, old, new, label):
    p = root / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'{label} anchor not found')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

# Fix the actual V10.3.4 bug: node:sqlite DatabaseSync has no db.transaction() helper.
replace_once(
    'app/src/main/ipc/operations.js',
    """    const tx = db.transaction(() => {
      db.prepare('UPDATE leads SET stage=?,sales_stage=?,updated_at=? WHERE id=?').run(restoredStage, restoredSales, ts, lead.id);
      db.prepare('DELETE FROM clients WHERE id=?').run(clientId);
      logLeadEvent(db, lead.id, 'Client conversion reversed', `Accidental client conversion removed. Restored to ${restoredStage}.`, 'client', 'Clients');
    });
    tx();
    return { ok:true, leadId:lead.id, businessName:lead.name, stage:restoredStage, salesStage:restoredSales };""",
    """    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE leads SET stage=?,sales_stage=?,updated_at=? WHERE id=?').run(restoredStage, restoredSales, ts, lead.id);
      db.prepare('DELETE FROM clients WHERE id=?').run(clientId);
      logLeadEvent(db, lead.id, 'Client conversion reversed', `Accidental client conversion removed. Restored to ${restoredStage}.`, 'client', 'Clients');
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return { ok:true, leadId:lead.id, businessName:lead.name, stage:restoredStage, salesStage:restoredSales };""",
    'sqlite transaction fix'
)

# Make the result obvious: go straight back to Leads after success and show any failure visibly.
replace_once(
    'app/src/renderer/app.js',
    """      await Promise.all([loadLeads(),refreshClients(),refreshDashboard()]);
      setSaveState(`${result.businessName} moved back to Leads · ${result.stage}`,'saved');
    }catch(error){
      revertButton.disabled=false;
      setMessage(clientMessage,error.message||'Could not move this client back to Leads.','error');
    }
    return;""",
    """      await Promise.all([loadLeads(),refreshClients(),refreshDashboard()]);
      switchView('leadFinder');
      setSaveState(`${result.businessName} moved back to Leads · ${result.stage}`,'saved');
    }catch(error){
      revertButton.disabled=false;
      const message=error.message||'Could not move this client back to Leads.';
      setMessage(clientMessage,message,'error');
      alert(message);
    }
    return;""",
    'client revert UI fix'
)

# Clarify the button.
replace_once(
    'app/src/renderer/app.js',
    'title="Undo an accidental Add as Client conversion">Back to Lead</button>',
    'title="Remove the accidental client conversion and return this business to Leads">Remove Client → Lead</button>',
    'client revert button label'
)

# Version bump.
pkg = root / 'app/package.json'
data = json.loads(pkg.read_text(encoding='utf-8'))
data['version'] = '10.3.5'
data['description'] = 'FirstSeen Digital desktop operating app - V10.3.5 fixes Remove Client → Lead for accidental client conversions.'
pkg.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')

for rel in [
    'app/README.md','app/docs/WINDOWS_INSTALLER_V10.md','app/installer/README.md',
    'app/installer/install.ps1','install.ps1','app/src/renderer/index.html','app/src/renderer/app.js'
]:
    p = root / rel
    if p.exists():
        p.write_text(p.read_text(encoding='utf-8').replace('10.3.4','10.3.5'), encoding='utf-8')

(root / 'app/docs/RELEASE_NOTES_V10_3_5.md').write_text("""# FirstSeen Desktop V10.3.5

- Fixes the Desktop **Remove Client → Lead** button.
- V10.3.4 used a transaction helper that does not exist on Node's built-in SQLite DatabaseSync, causing the click to fail.
- The rollback now uses explicit SQLite BEGIN / COMMIT / ROLLBACK.
- On success, the accidental Client record is removed, the original CRM Lead is kept, its pre-Won stage is restored from the lead timeline where possible, and FirstSeen immediately opens Leads.
- If rollback is blocked by linked payment/schedule data or another error, FirstSeen now shows the reason visibly instead of appearing to do nothing.
- Existing Supabase lead sync remains intact; the restored lead timestamp is updated so normal cloud sync can propagate the change.
""", encoding='utf-8')

for rel in ['app/src/main/ipc/operations.js','app/src/renderer/app.js','app/src/preload.js']:
    subprocess.run(['node','--check',str(root/rel)],check=True)

print('V10.3.5 client rollback fix applied and syntax checked')
