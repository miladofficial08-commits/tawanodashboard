// Mock-Auth für lokales Testen ohne Supabase
window.MOCK_MODE = true;

// Überschreibe die Login-Funktion für Tests
const originalLoginWithPassword = window.loginWithPassword;
window.loginWithPassword = async function() {
  const email = (document.getElementById('login-email').value || '').trim();
  const password = document.getElementById('login-password').value || '';

  if (!email || !password) {
    setAuthInfo('Bitte E-Mail und Passwort eingeben.', 'err');
    return;
  }

  setAuthInfo('Mock-Login lädt...', '');

  // Simuliere erfolgreichen Login
  setTimeout(() => {
    authToken = 'mock_token_' + Math.random().toString(36).substring(7);
    currentUser = { email };
    localStorage.setItem('tawano_access_token', authToken);
    localStorage.setItem('tawano_user', JSON.stringify(currentUser));
    setAuthInfo('Eingeloggt (Mock-Modus).', 'ok');
    showDashboard();

    // Mock-Daten laden
    calls = generateMockCalls();
    render();
    setStatus('ok', 'Live (Mock-Daten)');
  }, 800);
};

function generateMockCalls() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return [
    {
      call_id: '1',
      agent_id: 'agent_6cada34aac5785c950da3d919b',
      to_number: '+491631283971',
      from_number: '+491234567890',
      start_timestamp: today.getTime(),
      end_timestamp: today.getTime() + 300000,
      call_status: 'completed',
      disconnection_reason: 'user_hangup',
      call_analysis: {
        call_summary: 'Der Kunde fragte nach Nageldesign und vereinbarte einen Termin.',
        custom_analysis_data: {
          summary: 'Der Kunde fragte nach Nageldesign und vereinbarte einen Termin.',
          sentiment: 'positiv',
          next_step: 'Termin morgen 10:00 Uhr'
        },
        user_sentiment: 'positiv'
      }
    },
    {
      call_id: '2',
      agent_id: 'agent_6cada34aac5785c950da3d919b',
      to_number: '+491561234567',
      from_number: '+491234567890',
      start_timestamp: today.getTime() + 600000,
      end_timestamp: today.getTime() + 900000,
      call_status: 'completed',
      disconnection_reason: 'dial_no_answer',
      call_analysis: {
        call_summary: 'Der Kunde war nicht direkt erreichbar.',
        custom_analysis_data: {
          summary: 'Der Kunde war nicht direkt erreichbar.',
          sentiment: 'neutral'
        }
      }
    },
    {
      call_id: '3',
      agent_id: 'agent_6cada34aac5785c950da3d919b',
      to_number: '+491791234567',
      from_number: '+491234567890',
      start_timestamp: today.getTime() + 1200000,
      end_timestamp: today.getTime() + 1500000,
      call_status: 'completed',
      disconnection_reason: 'user_hangup',
      call_analysis: {
        call_summary: 'Kunde hat nach Öffnungszeiten gefragt und möchte zurückgerufen werden.',
        custom_analysis_data: {
          summary: 'Kunde hat nach Öffnungszeiten gefragt und möchte zurückgerufen werden.',
          sentiment: 'neutral',
          next_step: 'Heute um 14:00 Uhr zurückrufen'
        }
      }
    }
  ];
}

console.log('✓ Mock-Auth aktiviert für lokales Testen');
console.log('Nutze beliebige E-Mail und Passwort zum Testen');
