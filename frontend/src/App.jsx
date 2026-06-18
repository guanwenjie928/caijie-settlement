import { useState } from 'react';
import { FileText, PlusCircle, Settings as SettingsIcon, Trash2, Download, Users, BookOpen } from 'lucide-react';
import SettlementList from './components/SettlementList';
import NewRecord from './components/NewRecord';
import SettingsPage from './components/SettingsPage';
import DeletedRecords from './components/DeletedRecords';
import PersonStats from './components/PersonStats';
import TaxKnowledge from './components/TaxKnowledge';

/**
 * 主应用组件 — 侧边栏导航 + 内容区
 */
function App() {
  const [activePage, setActivePage] = useState('list');

  const navItems = [
    { id: 'list', label: '结算列表', icon: FileText },
    { id: 'new', label: '新增票据', icon: PlusCircle },
    { id: 'stats', label: '人员统计', icon: Users },
    { id: 'tax', label: '财会知识', icon: BookOpen },
    { id: 'settings', label: '系统设置', icon: SettingsIcon },
    { id: 'deleted', label: '已删除记录', icon: Trash2 },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 侧边栏 */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-800">财会结算系统</h1>
          <p className="text-xs text-gray-400 mt-1">票据管理与结算</p>
        </div>
        <nav className="flex-1 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${
                  activePage === item.id
                    ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="px-6 py-4 border-t border-gray-200">
          <button
            onClick={() => setActivePage('list')}
            className="w-full flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 transition-colors"
          >
            <Download size={16} />
            导出Excel
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto">
        {activePage === 'list' && <SettlementList />}
        {activePage === 'new' && <NewRecord />}
        {activePage === 'stats' && <PersonStats />}
        {activePage === 'tax' && <TaxKnowledge />}
        {activePage === 'settings' && <SettingsPage />}
        {activePage === 'deleted' && <DeletedRecords />}
      </main>
    </div>
  );
}

export default App;
