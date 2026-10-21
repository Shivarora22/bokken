import { Box, Text, useApp } from 'ink';
import { useState } from 'react';
import { LANGUAGES, SETUP_LANGUAGES } from '../languages.js';
import { Select, TextInput } from './components.jsx';
import { expandHome, tildePath } from './practice.js';

const EDITOR_HINTS = {
  micro: 'easy: ctrl+s saves, ctrl+q quits',
  nano: 'easy: ctrl+o saves, ctrl+x quits',
  edit: 'easy: ctrl+s saves, ctrl+q quits',
  nvim: 'for vim users',
  vim: 'for vim users',
  vi: 'for vim users',
  hx: 'modal, like vim',
};

const STEPS = ['language', 'editor', 'workspace', 'ai'];

/**
 * First run, `/setup` and `bokken setup`: language, editor, folder, and whether to set up
 * AI now. `onDone(config, { setupAi })`.
 */
export function Setup({ ctx, config, firstRun, onDone }) {
  const { suspendTerminal } = useApp();
  const [step, setStep] = useState('language');
  const [answers, setAnswers] = useState({ language: config.language, editor: config.editor, workspace: config.workspace });
  const [editors, setEditors] = useState(() => ctx.listEditors({ preferred: config.editor }));
  const [note, setNote] = useState(null);
  const suggestion = editors.length ? null : ctx.installSuggestion();

  const answer = (key, value) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setStep(STEPS[STEPS.indexOf(key) + 1]);
  };

  const finish = (aiChoice) => {
    const next = { ...config, language: answers.language, editor: answers.editor, workspace: answers.workspace };
    ctx.saveConfig(next);
    onDone(next, { setupAi: aiChoice === 'now' });
  };
  const aiReady = Boolean(config.ai.provider && config.ai.model);

  const chooseEditor = async (value) => {
    if (value === 'install') {
      await suspendTerminal(() => ctx.runInstall(suggestion));
      const found = ctx.listEditors({ preferred: config.editor });
      setEditors(found);
      setNote(found.length ? null : `Still no editor found. You can install one later and run /setup again.`);
      return;
    }
    answer('editor', value === 'skip' ? null : value);
  };

  const editorName = editors.find((e) => e.command === answers.editor)?.name ?? answers.editor;
  const rows = [
    { key: 'language', label: 'Preferred language', value: LANGUAGES[answers.language]?.name },
    { key: 'editor', label: 'Editor', value: editorName ?? 'none yet' },
    { key: 'workspace', label: 'Folder for solutions', value: tildePath(answers.workspace) },
    { key: 'ai', label: aiReady ? 'Change AI help?' : 'Set up AI help now?', value: '' },
  ];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>{firstRun ? 'Welcome to bokken. Quick setup:' : 'Setup'}</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row) => {
          const done = STEPS.indexOf(row.key) < STEPS.indexOf(step);
          const current = row.key === step;
          return (
            <Box key={row.key} flexDirection="column">
              <Text>
                <Text color={done ? 'green' : 'cyan'}>{done ? '✓ ' : current ? '› ' : '  '}</Text>
                <Text bold={current}>{row.label.padEnd(22)}</Text>
                {done && row.value && <Text>{row.value}</Text>}
              </Text>
              {current && <Box marginLeft={4} marginY={1} flexDirection="column">{renderStep(row.key)}</Box>}
            </Box>
          );
        })}
        <Text dimColor>{'  '}{'LeetCode login'.padEnd(22)}coming in a later version</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{step === 'workspace' ? 'Enter to confirm' : '↑↓ choose · Enter confirm'}</Text>
      </Box>
    </Box>
  );

  function renderStep(key) {
    if (key === 'language') {
      const items = SETUP_LANGUAGES.map((slug) => ({ label: LANGUAGES[slug].name, value: slug }));
      return <Select items={items} initial={answers.language} onSelect={(value) => answer('language', value)} />;
    }
    if (key === 'editor') {
      if (editors.length) {
        const items = editors.map((e) => ({ label: e.name, value: e.command, hint: EDITOR_HINTS[e.name] }));
        return <Select items={items} initial={answers.editor ?? editors[0].command} onSelect={chooseEditor} />;
      }
      const items = [
        ...(suggestion ? [{ label: 'Install micro now', value: 'install', hint: `runs: ${suggestion}` }] : []),
        { label: 'Skip for now', value: 'skip' },
      ];
      return (
        <>
          <Text color="yellow">{note ?? 'No terminal editor found.'}</Text>
          <Select key={note} items={items} initial={items[0].value} onSelect={chooseEditor} />
        </>
      );
    }
    if (key === 'workspace') {
      return (
        <TextInput
          prompt=""
          initialValue={tildePath(answers.workspace)}
          onSubmit={(value) => answer('workspace', expandHome(value.trim() || answers.workspace))}
        />
      );
    }
    const items = aiReady
      ? [
          { label: 'Keep it', value: 'later', hint: `${config.ai.provider}, ${config.ai.model}` },
          { label: 'Change it now', value: 'now' },
        ]
      : [
          { label: 'Later', value: 'later', hint: 'type /ai anytime' },
          { label: 'Now', value: 'now', hint: 'hints, explanations, chat; Claude, OpenAI, Gemini or a local model' },
        ];
    return <Select items={items} initial="later" onSelect={finish} />;
  }
}
