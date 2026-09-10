/**
 * estado-limpo.ts — devolve as contas de teste ao padrão de fábrica.
 *
 * ─── AS PREFERÊNCIAS DA CONTA VAZAM ENTRE EXECUÇÕES E ENTRE SUÍTES ─────────
 *
 * Desde que tamanho de carta, barra de ações, log e painel de vida passaram a
 * ser gravados na CONTA — e não só no `localStorage`, que cada contexto do
 * Playwright cria do zero — o estado deixado por uma execução chega hidratado
 * na próxima.
 *
 * O efeito é concreto e foi observado nas duas suítes:
 *
 *   - `mesa-multijogador` abre a mesa clicando em "Ações" para expandir a
 *     barra, e isso grava `barraAberta: true`. Na execução seguinte a barra já
 *     nasce aberta, e o teste "a mesa abre limpa" — que afirma exatamente o
 *     contrário — passa a testar uma tela que só existe na primeira vez.
 *   - `sala-publica-e-espectador` usa as mesmas contas, então rodá-la depois
 *     da outra herdava o estado dela. A ordem de execução das suítes virava
 *     parte do resultado.
 *
 * ─── POR QUE NO `beforeAll` E NÃO SÓ NA FIXTURE DE PREPARAÇÃO ──────────────
 *
 * `preparar-jogadores.mjs` também zera, e continua fazendo sentido: quem monta
 * o ambiente quer o ambiente limpo. Mas ela roda UMA vez, e as suítes rodam
 * várias — inclusive uma depois da outra, na mesma preparação.
 *
 * Isolamento de teste não é "arrumar o mundo para esconder sujeira": é
 * garantir que o estado inicial seja conhecido. Uma suíte cujo resultado
 * depende de qual suíte rodou antes não afirma nada sobre o produto.
 *
 * `{}` é o valor padrão da coluna (ver a migração `preferencias_de_mesa`), e o
 * cliente o lê como "nunca configurou" — então o padrão de fábrica volta a
 * valer sem apagar mais nada da conta.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:3333/api/v1';

export async function zerarPreferenciasDeMesa(tokens: string[]): Promise<void> {
  await Promise.all(
    tokens.map((token) =>
      fetch(`${API}/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ preferenciasDeMesa: {} }),
        // Falhar aqui NÃO derruba a suíte: sem o reset ela ainda roda, só fica
        // sujeita ao estado anterior. Derrubar tudo por causa da limpeza
        // trocaria um teste instável por uma suíte que não roda.
      }).catch(() => undefined),
    ),
  );
}
