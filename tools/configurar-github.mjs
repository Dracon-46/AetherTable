#!/usr/bin/env node
/**
 * configurar-github.mjs — as configurações do repositório no GitHub, como código.
 *
 * ─── POR QUE UM SCRIPT, E NÃO CLIQUES EM SETTINGS ──────────────────────────
 *
 * Configuração feita à mão na tela de Settings não tem histórico nem revisão,
 * e ninguém sabe dizer depois por que a `main` aceita force push ou por que o
 * alerta de dependência está desligado. Aqui cada escolha está escrita com o
 * motivo, e reaplicar é idempotente: rodar duas vezes dá o mesmo resultado.
 *
 * Uso (precisa do `gh` logado numa conta ADMIN do repositório):
 *   gh auth status                              confira a conta ativa
 *   node tools/configurar-github.mjs            aplica tudo
 *   node tools/configurar-github.mjs --dry-run  só mostra o que faria
 *   node tools/configurar-github.mjs --repo Falkyria/AetherTable
 *
 * O que ele NÃO consegue fazer (o GitHub não expõe na API): criar a primeira
 * página da Wiki. Ver o aviso no fim da execução.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const SECO = args.includes('--dry-run');
const idxRepo = args.indexOf('--repo');
const REPO = idxRepo >= 0 ? args[idxRepo + 1] : 'Dracon-46/AetherTable';

/** Id do papel "Repository admin" nos rulesets (fixo na API do GitHub). */
const PAPEL_ADMIN = 5;

let falhas = 0;

function gh(metodo, caminho, corpo) {
  const argv = ['api', '--method', metodo, '-H', 'Accept: application/vnd.github+json', caminho];
  if (corpo !== undefined) argv.push('--input', '-');
  if (SECO) {
    console.log(`  [dry-run] ${metodo} ${caminho}${corpo ? ' ' + JSON.stringify(corpo) : ''}`);
    return null;
  }
  const saida = execFileSync('gh', argv, {
    input: corpo === undefined ? undefined : JSON.stringify(corpo),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return saida.trim() ? JSON.parse(saida) : null;
}

function passo(nome, fn) {
  try {
    fn();
    console.log(`✓ ${nome}`);
  } catch (erro) {
    falhas++;
    const detalhe = erro.stderr?.toString().trim() || erro.message;
    console.error(`✗ ${nome}\n    ${detalhe.split('\n').join('\n    ')}`);
  }
}

// ─── Repositório ─────────────────────────────────────────────────────────────

passo('descrição, recursos e merge', () =>
  gh('PATCH', `repos/${REPO}`, {
    description:
      'Mesa virtual sandbox de Magic: The Gathering (Commander/EDH), multiformato e em tempo real. Produto da Falkyria.',
    homepage: 'https://aether-table-frontend.vercel.app',
    has_issues: true,
    // A fonte da Wiki é docs/wiki, publicada pelo workflow wiki.yml.
    has_wiki: true,
    // DOC-091: merge é sempre `--no-ff`. Squash e rebase apagariam a fronteira
    // da feature, que é o que permite reverter a feature inteira.
    allow_merge_commit: true,
    allow_squash_merge: false,
    allow_rebase_merge: false,
    merge_commit_title: 'PR_TITLE',
    merge_commit_message: 'PR_BODY',
    // Branch temporária some depois do merge (DOC-091 §4).
    delete_branch_on_merge: true,
    allow_auto_merge: true,
    allow_update_branch: true,
  }),
);

passo('tópicos', () =>
  gh('PUT', `repos/${REPO}/topics`, {
    names: [
      'magic-the-gathering',
      'mtg',
      'commander',
      'edh',
      'tabletop',
      'multiplayer',
      'colyseus',
      'nestjs',
      'nextjs',
      'typescript',
      'monorepo',
    ],
  }),
);

// ─── Segurança ───────────────────────────────────────────────────────────────

passo('alertas do Dependabot', () => gh('PUT', `repos/${REPO}/vulnerability-alerts`));
passo('correções automáticas do Dependabot', () =>
  gh('PUT', `repos/${REPO}/automated-security-fixes`),
);
passo('relato privado de vulnerabilidade (SECURITY.md aponta para ele)', () =>
  gh('PUT', `repos/${REPO}/private-vulnerability-reporting`),
);
passo('varredura de segredos com bloqueio no push', () =>
  gh('PATCH', `repos/${REPO}`, {
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      // Recusa o push que contém um segredo reconhecível — antes de ele chegar
      // ao histórico, onde limpar custa reescrita e force push.
      secret_scanning_push_protection: { status: 'enabled' },
    },
  }),
);

// ─── GitHub Actions ──────────────────────────────────────────────────────────

passo('token dos workflows só com leitura por padrão', () =>
  gh('PUT', `repos/${REPO}/actions/permissions/workflow`, {
    // Quem precisa escrever (release, wiki, codeql) declara no próprio job.
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false,
  }),
);

passo('só actions do GitHub e as listadas, fixadas por SHA', () => {
  gh('PUT', `repos/${REPO}/actions/permissions`, {
    enabled: true,
    allowed_actions: 'selected',
    sha_pinning_required: true,
  });
  gh('PUT', `repos/${REPO}/actions/permissions/selected-actions`, {
    github_owned_allowed: true,
    verified_allowed: false,
    patterns_allowed: ['pnpm/action-setup@*'],
  });
});

// ─── Labels ──────────────────────────────────────────────────────────────────

const LABELS = [
  ['defeito', 'd73a4a', 'Algo que não funciona como deveria'],
  ['melhoria', 'a2eeef', 'Funcionalidade nova ou mudança de comportamento'],
  ['segurança', 'b60205', 'Afeta conta, informação oculta ou infraestrutura'],
  ['documentação', '0075ca', 'Documentos, Wiki ou comentários'],
  ['mesa', 'fbca04', 'A partida em andamento (game-server e Canvas)'],
  ['dependencies', '0366d6', 'Atualização de dependência (Dependabot)'],
  ['ci', 'ededed', 'Workflows e automação do repositório'],
];

passo('labels', () => {
  const existentes = SECO ? [] : gh('GET', `repos/${REPO}/labels?per_page=100`).map((l) => l.name);
  for (const [name, color, description] of LABELS) {
    if (existentes.includes(name)) {
      gh('PATCH', `repos/${REPO}/labels/${encodeURIComponent(name)}`, { color, description });
    } else {
      gh('POST', `repos/${REPO}/labels`, { name, color, description });
    }
  }
});

// ─── Proteção de branches e tags (rulesets) ─────────────────────────────────
//
// O admin fica na lista de bypass: é ele quem corta release e hotfix direto na
// `main` (DOC-091). Para todo o resto, a `main` e a `develop` só mudam por PR
// com o `CI ok` verde, e nunca aceitam force push nem exclusão.

const protecaoDeBranch = (nome, branch) => ({
  name: nome,
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
  bypass_actors: [{ actor_id: PAPEL_ADMIN, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
        allowed_merge_methods: ['merge'],
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        // Um check só, o agregador do ci.yml: a matriz pode mudar sem a regra.
        required_status_checks: [{ context: 'CI ok' }],
      },
    },
  ],
});

const RULESETS = [
  protecaoDeBranch('Proteção da main', 'main'),
  protecaoDeBranch('Proteção da develop', 'develop'),
  {
    // Tag de release é o nome do que está em produção: não se move nem se apaga.
    name: 'Tags de release imutáveis',
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    bypass_actors: [{ actor_id: PAPEL_ADMIN, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'update' }],
  },
];

passo('rulesets', () => {
  const existentes = SECO ? [] : gh('GET', `repos/${REPO}/rulesets?per_page=100`);
  for (const ruleset of RULESETS) {
    const atual = existentes.find((r) => r.name === ruleset.name);
    if (atual) gh('PUT', `repos/${REPO}/rulesets/${atual.id}`, ruleset);
    else gh('POST', `repos/${REPO}/rulesets`, ruleset);
  }
});

// ─── Fim ─────────────────────────────────────────────────────────────────────

console.log(`
Wiki: o GitHub só cria o repositório git da Wiki depois da PRIMEIRA página.
Abra https://github.com/${REPO}/wiki, clique em "Create the first page" e salve
qualquer conteúdo. Depois rode o workflow "Wiki" (aba Actions → Wiki → Run
workflow): ele substitui a página pelo conteúdo de docs/wiki.

Releases das tags antigas: aba Actions → Release → Run workflow.`);

process.exit(falhas ? 1 : 0);
