import React from 'react';
import { useUIStore, useGameStore } from '../store/game.store';
import { Video, User, Users, ChevronDown } from 'lucide-react';

export function CameraControls() {
  const { boardView, setBoardView } = useUIStore();
  const { players, mySessionId } = useGameStore();

  const [isOpen, setIsOpen] = React.useState(false);

  const opponents = Object.values(players).filter(p => p.id !== mySessionId);

  const getLabel = () => {
    if (boardView === 'ALL') return 'Visão Geral (Todos)';
    if (boardView === 'ME') return 'Minha Mesa';
    if (boardView === 'OPPONENTS') return 'Oponentes';
    const player = players[boardView];
    return player ? `Mesa de ${player.name}` : 'Mesa Desconhecida';
  };

  return (
    <div className="absolute top-4 right-4 bg-panel/80 backdrop-blur border border-panel-border rounded shadow-lg flex flex-col pointer-events-auto z-50 animate-[fadeIn_0.3s_ease-out]">
      <div className="flex items-center gap-2 p-2 border-b border-panel-border bg-table-deep/50">
        <Video className="w-4 h-4 text-primary" />
        <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Câmera</span>
      </div>
      
      <div className="relative">
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="w-full min-w-[200px] flex items-center justify-between p-3 text-sm font-medium text-text hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <span className="flex items-center gap-2">
            {boardView === 'ME' ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            {getLabel()}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 bg-panel border border-panel-border rounded mt-1 shadow-xl overflow-hidden flex flex-col z-50">
            <button 
              onClick={() => { setBoardView('ALL'); setIsOpen(false); }}
              className={`p-3 text-sm text-left transition-colors ${boardView === 'ALL' ? 'bg-primary/20 text-primary font-bold' : 'text-text hover:bg-primary-subtle'}`}
            >
              Visão Geral (Todos)
            </button>
            <button 
              onClick={() => { setBoardView('ME'); setIsOpen(false); }}
              className={`p-3 text-sm text-left transition-colors ${boardView === 'ME' ? 'bg-primary/20 text-primary font-bold' : 'text-text hover:bg-primary-subtle'}`}
            >
              Minha Mesa
            </button>
            
            {opponents.length > 0 && (
              <div className="border-t border-panel-border pt-1 pb-1">
                <span className="px-3 py-1 text-[10px] font-bold text-text-muted uppercase">Oponentes</span>
                {opponents.map(opp => (
                  <button 
                    key={opp.id}
                    onClick={() => { setBoardView(opp.id); setIsOpen(false); }}
                    className={`w-full p-3 text-sm text-left transition-colors flex items-center gap-2 ${boardView === opp.id ? 'bg-primary/20 text-primary font-bold' : 'text-text hover:bg-primary-subtle'}`}
                  >
                    <div className="w-2 h-2 rounded-full bg-danger"></div>
                    Mesa de {opp.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
