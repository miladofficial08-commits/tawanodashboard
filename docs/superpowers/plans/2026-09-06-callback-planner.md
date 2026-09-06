# Rückrufplanung und Nutzungszeiträume

**Ziel:** Tages- und Wochenplanung mit dauerhaftem Bearbeitungsstatus, Notizen und Rückrufzeiten; konsistente Zeitfilter und getrennte Admin-Resets.

**Architektur:** Express/Netlify-Handler mit bestehender Supabase-Authentifizierung. Eine kunden- und agentgebundene Gesprächstabelle speichert abgerufene Gespräche sowie separat bearbeitbare Planungsfelder. Nur der Server importiert vom Anbieter geprüfte Gespräche. Der Browser berechnet Termine mit einer gemeinsamen, getesteten Europe/Berlin-Zeitfunktion. Unklare Angaben erhalten keinen erfundenen Termin.

**Entscheidungen:** Rückrufplanung als eigener Bereich. Löschen entfernt den Eintrag aus dem Dashboard und hält eine minimale Sperrmarkierung gegen erneuten Import; Aufnahmen beim Anbieter werden nicht gelöscht. Minutenreset beginnt ab dem Klickzeitpunkt, Gesprächsreset blendet frühere Gespräche aus. Keiner der beiden Vorgänge wird bei der Umsetzung auf echten Kundendaten ausgelöst. Beispieldaten ausschließlich in expliziter localhost-Vorschau.

- [x] Zeitlogik mit Tests für morgen, Wochentage, Zeitfenster, Jahreswechsel, Sommerzeit und ungültige Angaben erstellen (`public/planner-time.js`, `tests/planner-time.test.js`).
- [x] Persistente Gesprächsablage und abgesicherte Bearbeitungs-API erstellen (`supabase/call-workspace.sql`, `netlify/functions/_lib/call-workspace.js`, `netlify/functions/call-workspace.js`). Kundenidentität ausschließlich aus Auth; Fremdzugriffe und ungültige Änderungen testen.
- [x] Tages-/Wochenplan und Detailbearbeitung integrieren (`public/dashboard-planner.js`, `public/planner.css`, Dashboard-HTML/-Skripte). Änderungen erst nach erfolgreicher Speicherung anzeigen; Vorschau im Speicher.
- [x] Gemeinsame Zeitraumfilter für Kennzahlen und Auswertung, getrennte Minuten-/Gesprächsresets in der Verwaltung implementieren und testen.
- [x] Additive Migration, lokale Laufzeit, komplette Tests und Browserprüfung; kein automatisches Zurücksetzen echter Kunden.

Verifiziert am 2026-09-06: 25 Testdateien erfolgreich; echte Tawano-Daten (33 Gespräche); SQL-Integrationstest mit Rollback und ohne verbleibende Testdaten; Browserprüfung Tag/Woche, Terminverschiebung, Notizen, Erledigen, Löschen und benutzerdefinierte Auswertung; Smartphone-Breite 390 px geprüft. Lokal verfügbar, nicht erneut auf Railway veröffentlicht.
