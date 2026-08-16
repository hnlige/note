import React from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { useStore } from '../../store/useStore';
import { KnowledgeDoc } from '../../types';
import { 
  BookOpen, 
  Search, 
  Download, 
  FileText, 
  FileCode, 
  ChevronRight,
  TrendingUp,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { motion } from 'framer-motion';

const Knowledge: React.FC = () => {
  const { knowledge, addAsyncTask, addActivity } = useStore();
  const [searchTerm, setSearchTerm] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState('全部文档');

  const filteredDocs = knowledge.filter(doc => 
    (activeCategory === '全部文档' || doc.category === activeCategory) &&
    doc.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDownload = (doc: KnowledgeDoc) => {
    const content = [
      doc.title,
      `分类：${doc.category}`,
      `更新日期：${doc.updateDate}`,
      `文件大小：${doc.size}`,
      '',
      '该文件由督办知识库下载入口生成，请在接入正式文件服务后替换为原始文档内容。',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addAsyncTask({
      name: `下载：${doc.title}`,
      type: 'EXPORT'
    });
    addActivity({
      content: `已发起【${doc.title}】的下载任务，请在任务中心查看`,
      type: 'SYSTEM'
    });
  };

  const categories = [
    { name: '全部文档', count: knowledge.length },
    { name: '管理制度', count: knowledge.filter(k => k.category === '管理制度').length },
    { name: '操作手册', count: knowledge.filter(k => k.category === '操作手册').length },
    { name: '业务流程', count: knowledge.filter(k => k.category === '业务流程').length },
  ];

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">知识库</h1>
          <p className="text-slate-500 text-sm mt-1">查阅督办管理办法、操作指南及相关政策文件。</p>
        </div>
        <div className="relative max-w-sm w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="搜索政策文件、关键词..."
            className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-8">
        {/* Left: Categories */}
        <div className="w-64 shrink-0 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-2">
            {categories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setActiveCategory(cat.name)}
                className={`
                  w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all
                  ${activeCategory === cat.name ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-slate-600 hover:bg-slate-50'}
                `}
              >
                <span className="text-sm font-bold">{cat.name}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  activeCategory === cat.name ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {cat.count}
                </span>
              </button>
            ))}
          </div>

          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl">
            <h4 className="text-sm font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              下载排行
            </h4>
            <div className="space-y-4">
              {knowledge.slice(0, 3).map((doc, i) => (
                <div key={doc.id} onClick={() => handleDownload(doc)} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-500">{i + 1}</span>
                    <span className="text-xs font-semibold text-slate-300 group-hover:text-blue-400 transition-colors truncate max-w-[120px]">{doc.title}</span>
                  </div>
                  <ArrowUpRight className="w-3 h-3 text-slate-500" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Doc Grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredDocs.map((doc, index) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-xl bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors`}>
                    <FileText className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">
                    {doc.category}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors mb-2 leading-snug h-10 line-clamp-2">
                  {doc.title}
                </h3>
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-50">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                    <Clock className="w-3 h-3" />
                    {doc.updateDate}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                    <FileCode className="w-3 h-3" />
                    {doc.size}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => handleDownload(doc)}
                className="w-full bg-slate-50 py-3 text-xs font-bold text-slate-500 group-hover:bg-blue-600 group-hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                立即下载文档
              </button>
            </motion.div>
          ))}
          {filteredDocs.length === 0 && (
            <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-300">
              <Search className="w-12 h-12 mb-3 opacity-10" />
              <p className="text-sm font-bold">未找到匹配的文档</p>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default Knowledge;
