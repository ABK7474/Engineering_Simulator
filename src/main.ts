// Bağlama: hub ↔ bulmaca ↔ çözücü ↔ olay raporu.

import './style.css';
import fault from '../content/faults/door-power-01.json';
import { createRng } from './core/rng';
import type { FaultCard } from './core/types';
import { createHub } from './hub/hub';
import { showIncidentReport } from './puzzles/incident-report/report';
import { openSeriesCircuitPanel } from './puzzles/series-circuit/panel';
import { parseSeriesLedConfig, solveSeriesLed } from './solvers/circuit/series-led';
import { generateSeriesLed } from './solvers/circuit/series-led.generate';
import { resolveOutcome } from './solvers/circuit/series-led.outcomes';
import { buildSeriesLedReport } from './solvers/circuit/series-led.report';

const card = fault as FaultCard;
const stage = card.stages[0];
const config = parseSeriesLedConfig(stage.config);

// ?seed=123 ile tekrarlanabilir oturum (hata ayıklama için).
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const baseSeed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : Math.floor(Math.random() * 2 ** 31);
let attempt = 0;
let problem = generateSeriesLed(config, baseSeed);

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

const hub = createHub(app, { onInteract: openPuzzle });

function openPuzzle(): void {
  hub.suspend();
  openSeriesCircuitPanel(ui, {
    title: card.title,
    briefing: card.briefing,
    problem,
    onCancel: () => hub.resume(),
    onSubmit: (choiceId) => void runAttempt(choiceId),
  });
}

async function runAttempt(choiceId: string): Promise<void> {
  const choice = problem.choices.find((c) => c.id === choiceId)!;
  const sol = solveSeriesLed(problem.spec.vs, problem.spec.led.model, choice.r);
  const outcome = resolveOutcome(problem.spec, sol, createRng(problem.seed * 31 + attempt));
  const result = buildSeriesLedReport(stage.id, problem, choiceId, outcome);

  await hub.applyOutcome(outcome);

  const nextProblem = () => {
    // Yeni deneme yeni sayılarla gelir: rapordaki cevabı ezberlemek işe yaramasın.
    attempt++;
    problem = generateSeriesLed(config, baseSeed + attempt);
    hub.repairForRetry();
  };

  showIncidentReport(ui, result, {
    onRetry: () => {
      nextProblem();
      openPuzzle();
    },
    onClose: () => {
      if (!result.success) nextProblem();
      hub.resume();
    },
  });
}
