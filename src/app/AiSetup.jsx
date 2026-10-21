import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { asksForBaseUrl, chatModels, defaultModel, envKeyFor, PROVIDER_IDS, PROVIDERS, resolveAi } from '../ai/providers.js';
import { Select, TextInput } from './components.jsx';

/** `/ai` and `bokken ai setup`: provider, key, base URL (local servers), model. */
export function AiSetup({ ctx, config, onDone, onCancel }) {
  const [step, setStep] = useState('provider');
  const [draft, setDraft] = useState({ provider: config.ai.provider ?? 'anthropic', apiKey: null, apiKeyEnv: null, baseUrl: '' });
  const [models, setModels] = useState([]);
  const [error, setError] = useState(null);
  const preset = PROVIDERS[draft.provider];
  const envKey = envKeyFor(draft.provider, ctx.env);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const afterKey = (next) => {
    setDraft(next);
    setError(null);
    setStep(asksForBaseUrl(next.provider) ? 'baseUrl' : 'check');
  };

  const chooseProvider = (id) => {
    const next = { provider: id, apiKey: null, apiKeyEnv: null, baseUrl: PROVIDERS[id].baseUrl ?? '' };
    if (PROVIDERS[id].key === 'none') return afterKey(next);
    setDraft(next);
    setStep(envKeyFor(id, ctx.env) ? 'keySource' : 'key');
  };

  // List the models: it also checks the key and URL, and costs nothing.
  useEffect(() => {
    if (step !== 'check') return undefined;
    let cancelled = false;
    const settings = resolveAi({ ai: { ...draft, model: 'checking' } }, { ai: { apiKey: draft.apiKey } }, ctx.env);
    ctx.listAiModels(settings).then(
      (ids) => {
        if (cancelled) return;
        setModels(chatModels(ids));
        setStep(ids.length ? 'model' : 'typeModel');
      },
      (failure) => {
        if (cancelled) return;
        setError(failure.message);
        setStep('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [step]);

  const save = (model) => {
    const ai = { ...config.ai, provider: draft.provider, model, baseUrl: asksForBaseUrl(draft.provider) ? draft.baseUrl : null, apiKeyEnv: draft.apiKeyEnv };
    const next = { ...config, ai };
    ctx.saveConfig(next);
    const credentials = ctx.loadCredentials();
    if (draft.apiKey) credentials.ai = { apiKey: draft.apiKey };
    else delete credentials.ai;
    ctx.saveCredentials(credentials);
    onDone(next);
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>AI coach setup</Text>
      <Text dimColor>Deeper hints, explanations and chat, with any provider. Esc to cancel.</Text>
      <Box flexDirection="column" marginTop={1}>
        {step !== 'provider' && <Done label="Provider" value={preset.name} />}
        {(draft.apiKey || draft.apiKeyEnv) && <Done label="API key" value={draft.apiKeyEnv ? `from $${draft.apiKeyEnv}` : 'pasted (saved only on this computer)'} />}
        {['check', 'model', 'typeModel', 'failed'].includes(step) && asksForBaseUrl(draft.provider) && <Done label="Base URL" value={draft.baseUrl} />}
        <Box marginTop={1} flexDirection="column">
          {renderStep()}
        </Box>
        {error && step !== 'failed' && <Text color="red">{error}</Text>}
      </Box>
    </Box>
  );

  function renderStep() {
    switch (step) {
      case 'provider':
        return (
          <Ask label="Provider">
            <Select
              items={PROVIDER_IDS.map((id) => ({ label: PROVIDERS[id].name, value: id, hint: PROVIDERS[id].hint }))}
              initial={draft.provider}
              onSelect={chooseProvider}
            />
          </Ask>
        );
      case 'keySource':
        return (
          <Ask label="API key">
            <Select
              items={[
                { label: `Use $${envKey}`, value: 'env', hint: 'found in your environment; nothing is saved' },
                { label: 'Paste a key', value: 'paste' },
              ]}
              initial="env"
              onSelect={(choice) => (choice === 'env' ? afterKey({ ...draft, apiKeyEnv: envKey }) : setStep('key'))}
            />
          </Ask>
        );
      case 'key':
        return (
          <Ask label={preset.key === 'optional' ? 'API key (Enter to skip)' : 'API key'}>
            <TextInput
              prompt=""
              mask
              onSubmit={(value) => {
                const apiKey = value.trim();
                if (!apiKey && preset.key === 'required') return setError(`${preset.name} needs a key.`);
                afterKey({ ...draft, apiKey: apiKey || null });
              }}
            />
          </Ask>
        );
      case 'baseUrl':
        return (
          <Ask label="Base URL">
            <TextInput
              prompt=""
              initialValue={draft.baseUrl}
              placeholder="https://…/v1"
              onSubmit={(value) => {
                const baseUrl = value.trim();
                if (!/^https?:\/\//.test(baseUrl)) return setError('Enter a URL starting with http:// or https://');
                setError(null);
                setDraft({ ...draft, baseUrl });
                setStep('check');
              }}
            />
          </Ask>
        );
      case 'check':
        return <Text dimColor>Checking {preset.name}…</Text>;
      case 'model':
        return (
          <Ask label={`Model (${models.length} available)`}>
            <Select items={models.map((id) => ({ label: id, value: id }))} initial={defaultModel(draft.provider, models)} onSelect={save} filterable />
          </Ask>
        );
      case 'typeModel':
        return (
          <Ask label="Model name">
            <TextInput prompt="" placeholder="as your provider names it" onSubmit={(value) => value.trim() && save(value.trim())} />
          </Ask>
        );
      default:
        return (
          <Ask label="That didn't work">
            <Text color="red">{error}</Text>
            <Select
              items={[
                { label: 'Try again', value: 'retry' },
                { label: 'Start over', value: 'restart' },
                { label: 'Type a model name anyway', value: 'type' },
              ]}
              initial="retry"
              onSelect={(choice) => {
                setError(null);
                setStep(choice === 'retry' ? 'check' : choice === 'restart' ? 'provider' : 'typeModel');
              }}
            />
          </Ask>
        );
    }
  }
}

function Done({ label, value }) {
  return (
    <Text>
      <Text color="green">✓ </Text>
      {label.padEnd(10)}
      {value}
    </Text>
  );
}

function Ask({ label, children }) {
  return (
    <Box flexDirection="column">
      <Text bold>
        <Text color="cyan">› </Text>
        {label}
      </Text>
      <Box marginLeft={2} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
