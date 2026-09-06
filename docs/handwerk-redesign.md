# Handwerker-Dashboard: Umsetzung und Abnahme

Ziel: Bestehendes Kundenportal und Admin-Portal für Handwerksbetriebe vereinfachen, die Agent-Zuordnung absichern und beide lokal prüfbar machen.

## Gestaltung

Dunkle Navigation, warme helle Arbeitsfläche, grüne Hauptaktionen. Übersicht mit offenen Aufgaben, heutigen Anrufen und Gesprächszeit. Anrufkarten zeigen Anliegen, Zeitpunkt und nächste Aktion. Keine erfundenen Umsatzwerte. Kontakte und Auswertung bleiben erreichbar. Admin: Kundenübersicht, Kundenanlage mit ElevenLabs als Vorgabe, erweiterte Einstellungen einklappbar.

Ergänzung nach Nutzerfeedback: Anliegen als kurze fette Überschrift, maximal zwei Fakten als Stichpunkte und ein klar hervorgehobener nächster Schritt. Ein zusätzlicher Bereich „Aufgaben“ sammelt offene Rückrufe, neue Anfragen und zu prüfende Gespräche; älteste zuerst. Rückrufzeiten werden wortgetreu aus passenden Gesprächssätzen übernommen und nicht auf heute umgedeutet. Beautyworld ist standardmäßig ausgeblendet und über einen Schalter wieder sichtbar. Beispieldaten sind ausschließlich auf localhost mit explizitem `?preview=1` aktiv; neue echte Kunden erhalten keine Beispieldaten.

## Arbeitsschritte

- Kundentrennung: Detailabruf ohne Agent verbieten, Provider-Listen zusätzlich nach Agent prüfen, Anmeldung ohne aktive Mitgliedschaft ablehnen, Kalender-Schlüssel aus Kundenantwort entfernen. Regressionen mit fremden IDs und fehlender Mitgliedschaft testen.
- Kundenanlage: Provider und Agent validieren, doppelte Zuordnung prüfen, Agent beim Provider prüfen, bei Teilfehlern angelegte Datensätze zurückrollen. Eindeutige Datenbank-Indizes als Migration bereitstellen.
- Oberfläche: bestehende API-Verträge behalten, Styles und Skripte in eigene Dateien aufteilen, mobile Navigation und zugängliche Bedienelemente ergänzen. Admin-Aktionen und Detailansichten erhalten.
- Vorschau: Express lokal über npm run dev, explizit gekennzeichnete Beispieldaten für die visuelle Prüfung ohne Kundenzugang. Kein automatischer Deployment-Schritt.
- Abnahme: bestehende Tests plus neue Sicherheitsregressionen, lokale HTTP-Prüfung, Browserprüfung von Dashboard und Admin bei Desktop- und Mobilbreite.

## Voraussetzungen für echte Daten

SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY und ADMIN_SECRET; für ElevenLabs zusätzlich ELEVENLABS_API_KEY mit Zugriff auf den Agent und dessen Gespräche. Pro Kunde ein eigener Agent. Telefonie/Rufnummer muss im Provider diesem Agent zugeordnet sein; die Agent-ID im Dashboard richtet keine Telefonie ein. Migrationen in Supabase müssen vorhanden sein.
