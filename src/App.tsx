/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  Settings2, 
  Table as TableIcon, 
  TrendingUp, 
  Package, 
  Trash2, 
  Search,
  Calculator,
  ArrowRight,
  Info,
  DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// Types
interface ShippingRate {
  region: string;
  weightBuckets?: Record<string, number>; // e.g. { "0-1kg": 2.3 }
  firstWeight: number;
  firstPrice: number;
  addWeight: number;
  addPrice: number;
  // Heavy goods fields
  transferFee?: number;
  waybillFee?: number;
}

interface ProductLibraryItem {
  name: string;
  cost: number;
  weight: number;
}

interface ProductItem {
  id: string;
  name: string;
  cost: number;
  weight: number;
  quantity: number;
}

interface ProductConfig {
  items: ProductItem[];
  targetMargin: number; 
  expectedOtherCosts: number;
}

export default function App() {
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [library, setLibrary] = useState<ProductLibraryItem[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [libFileName, setLibFileName] = useState<string>('');
  const [product, setProduct] = useState<ProductConfig>({
    items: [{ id: '1', name: '', cost: 0, weight: 0, quantity: 1 }],
    targetMargin: 0.3,
    expectedOtherCosts: 0
  });
  const [simulatedPrice, setSimulatedPrice] = useState<number | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isCalculated, setIsCalculated] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<{ type: 'product' | 'region', id?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const libInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click outside handler
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Aggregated Values
  const totalBaseCost = useMemo(() => 
    product.items.reduce((sum, item) => sum + (item.cost * item.quantity), 0)
  , [product.items]);

  const totalWeight = useMemo(() => 
    product.items.reduce((sum, item) => sum + (item.weight * item.quantity), 0)
  , [product.items]);

  // Pricing engine
  const calculateCostForRate = (rate: ShippingRate) => {
    const effectiveWeight = Math.ceil(totalWeight);
    let shippingCost = 0;
    let foundInBucket = false;
    let isHeavyLogic = false;

    // 0. Heavy Goods Logic (>3kg)
    if (effectiveWeight > 3 && (rate.waybillFee !== undefined || rate.addPrice > 0)) {
      // Formula: Waybill Fee + (Incremental Fee * Effective Weight)
      shippingCost = (rate.waybillFee || 0) + (effectiveWeight * (rate.addPrice || 0));
      isHeavyLogic = true;
    } else {
      // 1. Check weight buckets (e.g. 0-1kg, 1-2kg, 2-3kg as shown in user image)
      if (rate.weightBuckets) {
        for (const [range, price] of Object.entries(rate.weightBuckets)) {
          // Handle "0-1kg", "1-2kg" styles
          const cleanRange = range.replace(/kg/gi, '').trim();
          const parts = cleanRange.split('-');
          if (parts.length === 2) {
            const min = parseFloat(parts[0]);
            const max = parseFloat(parts[1]);
            // If effective weight falls within the integer range
            if (effectiveWeight > min && effectiveWeight <= max) {
              shippingCost = price;
              foundInBucket = true;
              break;
            }
          }
        }
      }

      // 2. Fallback to standard first/add weight calculation
      if (!foundInBucket) {
        shippingCost = rate.firstPrice;
        if (effectiveWeight > rate.firstWeight && rate.addWeight > 0) {
          const extraWeight = effectiveWeight - rate.firstWeight;
          const increments = Math.ceil(extraWeight / rate.addWeight);
          shippingCost += increments * rate.addPrice;
        }
      }
    }

    const totalCost = totalBaseCost + shippingCost + product.expectedOtherCosts;
    const suggestedPrice = product.targetMargin < 1 ? totalCost / (1 - product.targetMargin) : totalCost;
    const actualMargin = simulatedPrice ? (simulatedPrice - totalCost) / simulatedPrice : (suggestedPrice - totalCost) / suggestedPrice;

    return {
      rate,
      shippingCost,
      totalCost,
      suggestedPrice,
      actualMargin,
      profit: (simulatedPrice || suggestedPrice) - totalCost,
      isMarginMet: actualMargin !== null ? actualMargin >= product.targetMargin : true,
      isHeavyLogic
    };
  };

  const focusedResult = useMemo(() => {
    if (!selectedRegion) return null;
    const rate = rates.find(r => r.region === selectedRegion);
    if (!rate) return null;
    return calculateCostForRate(rate);
  }, [selectedRegion, rates, totalWeight, totalBaseCost, product.targetMargin, product.expectedOtherCosts, simulatedPrice]);

  // Template generation
  const downloadTemplate = (type: 'rates' | 'library' | 'heavy') => {
    if (type === 'rates') {
      const templateData = [
        { "省份": "江苏", "0-1kg": 2.3, "1-2kg": 3, "2-3kg": 3.5, "3.01": 3.5, "续重费": 0.8 },
        { "省份": "上海", "0-1kg": 2.8, "1-2kg": 3.5, "2-3kg": 4, "3.01": 3.5, "续重费": 0.8 },
        { "省份": "北京", "0-1kg": 3, "1-2kg": 3.8, "2-3kg": 4.5, "3.01": 3.5, "续重费": 1.5 },
      ];
      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "快递资费");
      XLSX.writeFile(wb, "快递资费模板(阶梯报价+大货).xlsx");
    } else if (type === 'heavy') {
      const templateData = [
        { "省份": "江浙沪", "中转费": 0.8, "面单费": 3.5 },
      ];
      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "重货资费");
      XLSX.writeFile(wb, "重货资费模板(Legacy).xlsx");
    } else {
      const templateData = [
        { "产品名称": "示例商品A", "成本元": 25.5, "单个重量kg": 0.35 },
        { "产品名称": "示例商品B", "成本元": 12.0, "单个重量kg": 0.12 },
      ];
      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "产品资料库");
      XLSX.writeFile(wb, "产品库导入模板.xlsx");
    }
  };

  // Product Management
  const addProductItem = () => {
    const newItem: ProductItem = {
      id: Math.random().toString(36).substr(2, 9),
      name: '',
      cost: 0,
      weight: 0,
      quantity: 1
    };
    setProduct({ ...product, items: [...product.items, newItem] });
  };

  const removeProductItem = (id: string) => {
    if (product.items.length === 1) return;
    setProduct({ ...product, items: product.items.filter(i => i.id !== id) });
  };

  const updateProductItem = (id: string, updates: Partial<ProductItem>) => {
    setProduct({
      ...product,
      items: product.items.map(item => item.id === id ? { ...item, ...updates } : item)
    });
  };

  // Library logic
  const handleLibraryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLibFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any>(ws);
      
      // Deduplicate by name
      const libMap = new Map<string, ProductLibraryItem>();
      data.forEach(row => {
        const name = String(row['产品名称'] || row['name'] || Object.values(row)[0]);
        if (name && name !== 'undefined') {
          libMap.set(name, {
            name,
            cost: parseFloat(row['成本元'] || row['成本'] || row['cost']) || 0,
            weight: parseFloat(row['单个重量kg'] || row['重量'] || row['weight']) || 0,
          });
        }
      });
      setLibrary(Array.from(libMap.values()));
    };
    reader.readAsBinaryString(file);
  };

  // Shipping Rates Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setIsCalculated(false);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any>(ws);
      
      const parsedRates: ShippingRate[] = data.map((row) => {
        const keys = Object.keys(row);
        const buckets: Record<string, number> = {};
        
        // 1. Detect weight ranges like "0-1kg", "1-2kg"
        keys.forEach(k => {
          if (k.match(/\d+-\d+k?g?/i)) {
            buckets[k] = parseFloat(row[k]) || 0;
          }
        });

        // 2. Fallback logic for regions and standard pricing
        const getVal = (keywords: string[]) => {
          const key = keys.find(k => keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase())));
          return key ? parseFloat(row[key]) : undefined;
        };
        const getRegion = () => {
          const key = keys.find(k => ['地区', '目的', '省', 'region', 'prov', 'dest', '城市', '省份'].some(kw => k.toLowerCase().includes(kw.toLowerCase())));
          return key ? String(row[key]) : '未知地区';
        };
        
        return {
          region: getRegion(),
          weightBuckets: Object.keys(buckets).length > 0 ? buckets : undefined,
          firstWeight: getVal(['首重重量', 'base w']) || 1,
          firstPrice: getVal(['首重价格', '首重费', 'first price', '0-1kg']) || 0,
          addWeight: getVal(['续重重量', 'add w']) || 1,
          addPrice: getVal(['续重价格', '续重费', 'add price', '续重费', 'incremental']) || 0,
          transferFee: getVal(['中转费', '中转', 'transfer']),
          waybillFee: getVal(['3.01', '面单费', '面单', 'waybill', '3kg以上']),
        };
      }).filter(r => r.region !== '未知地区' || r.firstPrice > 0 || r.transferFee !== undefined);
      
      // Merge logic: if regions are split (e.g. "山西、陕西") or if user uploads multiple files
      // We keep existing rates and merge new ones by region
      setRates(prev => {
        const merged = [...prev];
        parsedRates.forEach(nr => {
          const regions = nr.region.split(/[、,，\s]+/).filter(Boolean);
          regions.forEach(reg => {
            const idx = merged.findIndex(mr => mr.region === reg);
            if (idx >= 0) {
              merged[idx] = { ...merged[idx], ...nr, region: reg };
            } else {
              merged.push({ ...nr, region: reg });
            }
          });
        });
        return merged;
      });
    };
    reader.readAsBinaryString(file);
  };

  const startCalculation = () => {
    if (!fileName) { alert("请先导入快递表格"); return; }
    if (totalBaseCost <= 0) { alert("请输入产品成本"); return; }
    setIsCalculated(true);
  };

  const calculatedData = useMemo(() => {
    return rates.map(rate => calculateCostForRate(rate));
  }, [rates, totalWeight, totalBaseCost, product.targetMargin, product.expectedOtherCosts, simulatedPrice]);

  const filteredData = calculatedData.filter(d => d.rate.region.toLowerCase().includes(searchTerm.toLowerCase()));

  const clearData = () => {
    setRates([]); setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg text-white"><Calculator className="w-5 h-5" /></div>
            <h1 className="font-semibold text-lg tracking-tight">跨境电商快递定价助手</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <div className="space-y-4">
              <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Upload className="w-4 h-4 text-indigo-600" /><h2 className="font-medium text-sm">1. 导入快递资费</h2>
                    {rates.length > 0 && <div className="text-[10px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-bold">已加载 {rates.length} 地区</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => downloadTemplate('rates')} className="text-[10px] text-indigo-600 font-bold hover:underline">标准模板</button>
                    <button onClick={() => downloadTemplate('heavy')} className="text-[10px] text-indigo-600 font-bold hover:underline">重货模板</button>
                  </div>
                </div>
                <div 
                  onClick={() => fileInputRef.current?.click()} 
                  className={cn(
                    "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all",
                    fileName ? "border-indigo-200 bg-indigo-50/30" : "border-slate-200 hover:border-indigo-400 hover:bg-indigo-50"
                  )}
                >
                  <Upload className={cn("w-6 h-6 mx-auto mb-2", fileName ? "text-indigo-500" : "text-slate-400")} />
                  <p className="text-xs text-slate-500 font-medium">{fileName ? "继续上传累加/覆盖" : "点击导入标准或大货价格表"}</p>
                  <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">支持中转费+面单费逻辑</p>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls, .csv" />
                </div>
                {fileName && (
                   <div className="mt-3 flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-100 shadow-sm">
                      <div className="flex items-center gap-2 truncate">
                        <TableIcon className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="text-[10px] font-bold text-slate-600 truncate">{fileName}</span>
                      </div>
                      <button onClick={clearData} className="text-slate-300 hover:text-rose-500 ml-2 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                   </div>
                )}
              </section>

              <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-indigo-600" /><h2 className="font-medium text-sm">2. 导入产品资料库</h2>
                    {library.length > 0 && <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />}
                  </div>
                  <button onClick={() => downloadTemplate('library')} className="text-[10px] text-indigo-600 font-bold hover:underline">下载模板</button>
                </div>
                {!libFileName ? (
                  <div onClick={() => libInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-orange-400 hover:bg-orange-50 cursor-pointer transition-all">
                    <Upload className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                    <p className="text-xs text-slate-500 font-medium whitespace-nowrap">获取预设的产品成本与重量</p>
                    <input type="file" ref={libInputRef} onChange={handleLibraryUpload} className="hidden" accept=".xlsx, .xls, .csv" />
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-orange-50 p-2 rounded-lg border border-orange-100 uppercase text-[10px]">
                    <span className="font-bold text-orange-900 truncate pr-4">{libFileName}</span>
                    <button onClick={() => { setLibrary([]); setLibFileName(''); }} className="text-orange-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </section>
            </div>

            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-indigo-600" />
                  <h2 className="font-medium">3. 组合测算产品</h2>
                </div>
                <button onClick={addProductItem} className="text-[10px] px-2 py-1 bg-indigo-50 text-indigo-600 rounded-md font-bold hover:bg-indigo-100 transition-colors">+ 新增</button>
              </div>
              <div className="space-y-3 max-h-[350px] overflow-auto mb-6 pr-1 custom-scrollbar">
                {product.items.map((item, itemIdx) => (
                  <div key={item.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-200 transition-all">
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-12 mb-1 flex items-center justify-between gap-2 relative" ref={activeDropdown?.id === item.id ? dropdownRef : null}>
                        <div className="relative flex-grow">
                          <input 
                            type="text" 
                            value={item.name}
                            onFocus={() => setActiveDropdown({ type: 'product', id: item.id })}
                            onChange={(e) => {
                              const v = e.target.value; 
                              updateProductItem(item.id, { name: v });
                              const match = library.find(l => l.name === v);
                              if (match) updateProductItem(item.id, { cost: match.cost, weight: match.weight });
                            }}
                            className="bg-white border border-slate-200 rounded px-2 py-1.5 text-xs font-bold text-slate-700 w-full outline-none focus:ring-1 focus:ring-indigo-400"
                            placeholder="搜索或输入产品..."
                          />
                          <AnimatePresence>
                            {activeDropdown?.type === 'product' && activeDropdown?.id === item.id && (
                              <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                className="absolute top-full left-0 w-full mt-1 bg-white shadow-2xl border border-slate-100 rounded-lg z-[100] max-h-48 overflow-auto p-1 custom-scrollbar"
                              >
                                {library.length === 0 ? (
                                  <div className="p-3 text-[10px] text-slate-400 text-center italic">资资料库为空，请先导入</div>
                                ) : (
                                  library.filter(l => l.name.toLowerCase().includes(item.name.toLowerCase())).map((l, lIdx) => (
                                    <button 
                                      key={`${l.name}-${itemIdx}-${lIdx}`} 
                                      onClick={() => {
                                        updateProductItem(item.id, { name: l.name, cost: l.cost, weight: l.weight });
                                        setActiveDropdown(null);
                                      }} 
                                      className="w-full text-left px-3 py-2 text-[10px] hover:bg-indigo-50 rounded flex justify-between group transition-colors"
                                    >
                                      <span className="font-bold group-hover:text-indigo-700">{l.name}</span>
                                      <span className="text-slate-400 group-hover:text-indigo-400">¥{l.cost} / {l.weight}kg</span>
                                    </button>
                                  ))
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        {product.items.length > 1 && <button onClick={() => removeProductItem(item.id)} className="p-1 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                      <div className="col-span-4"><label className="block text-[8px] text-slate-400 font-black mb-1 uppercase">单品成本</label><input type="number" value={item.cost || ''} onChange={(e) => updateProductItem(item.id, { cost: parseFloat(e.target.value) || 0 })} className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[11px]" /></div>
                      <div className="col-span-4"><label className="block text-[8px] text-slate-400 font-black mb-1 uppercase">单品重量</label><input type="number" step="0.01" value={item.weight || ''} onChange={(e) => updateProductItem(item.id, { weight: parseFloat(e.target.value) || 0 })} className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[11px]" /></div>
                      <div className="col-span-4"><label className="block text-[8px] text-slate-400 font-black mb-1 uppercase">数量</label><input type="number" value={item.quantity || ''} onChange={(e) => updateProductItem(item.id, { quantity: parseInt(e.target.value) || 0 })} className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[11px]" /></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-indigo-900/5 p-4 rounded-xl border border-indigo-100 mb-6 flex justify-between items-center text-indigo-900 shadow-inner">
                <div><p className="text-[10px] font-bold uppercase text-indigo-400">合计基础成本</p><p className="text-lg font-black">¥ {totalBaseCost.toFixed(2)}</p></div>
                <div className="text-right"><p className="text-[10px] font-bold uppercase text-indigo-400">包裹总重</p><p className="text-lg font-black">{totalWeight.toFixed(2)} kg</p></div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-slate-500 uppercase">毛利率目标 (%)</label>
                    <div className="relative flex items-center">
                      <input 
                        type="number" 
                        value={Math.round(product.targetMargin * 100)} 
                        onChange={(e) => setProduct({...product, targetMargin: (parseFloat(e.target.value) || 0) / 100})}
                        className="w-16 px-2 py-1 text-right text-xs font-bold border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                      />
                      <span className="ml-1 text-xs text-slate-400">%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2">{[10, 20, 30, 40, 50].map(v => (
                    <button key={v} onClick={() => setProduct({...product, targetMargin: v/100})} className={cn("py-2 text-xs font-medium rounded-lg border transition-all", Math.round(product.targetMargin*100) === v ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100" : "bg-white text-slate-600 border-slate-200")}>{v}%</button>
                  ))}</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-xs font-semibold text-slate-500 mb-1 block">预估杂费</label><input type="number" value={product.expectedOtherCosts || ''} onChange={(e) => setProduct({...product, expectedOtherCosts: parseFloat(e.target.value) || 0})} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm" /></div>
                  <div><label className="text-xs font-semibold text-slate-500 mb-1 block">模拟售价</label><input type="number" value={simulatedPrice || ''} onChange={(e) => setSimulatedPrice(e.target.value ? parseFloat(e.target.value) : null)} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm" /></div>
                </div>

                {rates.length > 0 && (
                  <div className="relative" ref={activeDropdown?.type === 'region' ? dropdownRef : null}>
                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">指定目的地核算</label>
                    <div onClick={() => setActiveDropdown({ type: 'region' })} className="relative cursor-pointer">
                      <input 
                        type="text"
                        readOnly={activeDropdown?.type !== 'region'}
                        value={activeDropdown?.type === 'region' ? searchTerm : (selectedRegion || '搜索或选择目的地...')}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm appearance-none pr-10"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><Search className="w-4 h-4" /></div>
                    </div>
                    <AnimatePresence>
                      {activeDropdown?.type === 'region' && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute bottom-full left-0 w-full mb-2 bg-white shadow-2xl border border-slate-100 rounded-xl z-[150] max-h-60 overflow-auto p-1 custom-scrollbar">
                          <button onClick={() => { setSelectedRegion(''); setActiveDropdown(null); setSearchTerm(''); }} className="w-full text-left px-4 py-2 text-xs hover:bg-slate-50 rounded-lg text-slate-400 italic">-- 显示所有地区 --</button>
                          {rates.filter(r => r.region.includes(searchTerm)).map(r => (
                            <button key={r.region} onClick={() => { setSelectedRegion(r.region); setActiveDropdown(null); setSearchTerm(''); }} className={cn("w-full text-left px-4 py-2.5 text-sm hover:bg-indigo-50 rounded-lg transition-colors flex items-center justify-between", selectedRegion === r.region ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-700")}>
                              <span>{r.region}</span>
                              {selectedRegion === r.region && <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full" />}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                <button onClick={startCalculation} className="w-full bg-indigo-600 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all"><Calculator className="w-5 h-5" />开启定价矩阵</button>
              </div>
            </section>
          </div>

          <div className="lg:col-span-8 flex flex-col min-h-[600px]">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex-grow flex flex-col overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /><h2 className="font-semibold text-slate-700">{selectedRegion ? `地区详情: ${selectedRegion}` : "定价报表详情"}</h2></div>
                {!selectedRegion && <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" /><input type="text" placeholder="匹配过滤地区..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none w-48 focus:w-64 transition-all focus:border-indigo-400 shadow-sm" /></div>}
              </div>

              <div className="flex-grow overflow-auto custom-scrollbar">
                <AnimatePresence mode="wait">
                  {rates.length > 0 && isCalculated ? (
                    <div className="flex flex-col h-full">
                      {focusedResult && (
                        <div className="p-8 bg-indigo-600 text-white grid grid-cols-2 sm:grid-cols-4 gap-8 border-b border-indigo-500 relative overflow-hidden">
                           <div className="absolute top-0 right-0 p-4 opacity-5 rotate-12 scale-150"><Calculator className="w-48 h-48" /></div>
                           <div className="relative z-10"><p className="text-[10px] items-center flex gap-1 uppercase font-bold opacity-60 mb-2"><Info className="w-3 h-3" />物流成本</p><p className="text-3xl font-black font-mono">¥{focusedResult.shippingCost.toFixed(2)}</p></div>
                           <div className="relative z-10"><p className="text-[10px] items-center flex gap-1 uppercase font-bold opacity-60 mb-2"><DollarSign className="w-3 h-3" />建议售价</p><p className="text-3xl font-black font-mono">¥{focusedResult.suggestedPrice.toFixed(2)}</p></div>
                           <div className="relative z-10"><p className="text-[10px] items-center flex gap-1 uppercase font-bold opacity-60 mb-2"><TrendingUp className="w-3 h-3" />利润金额</p><p className="text-3xl font-black font-mono">¥{focusedResult.profit.toFixed(2)}</p></div>
                           <div className="relative z-10"><p className="text-[10px] items-center flex gap-1 uppercase font-bold opacity-60 mb-2"><TrendingUp className="w-3 h-3" />实际毛利</p><p className="text-3xl font-black font-mono">{(focusedResult.actualMargin! * 100).toFixed(1)}%</p></div>
                        </div>
                      )}
                      
                      <div className="flex-grow">
                        <table className="w-full text-left border-collapse text-sm">
                          <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 z-[1]">
                            <tr><th className="px-6 py-4 font-bold text-slate-500">目的地地区</th><th className="px-6 py-4 font-bold text-emerald-600 text-right">运费成本</th><th className="px-6 py-4 font-bold text-indigo-600 text-right bg-indigo-50/20">目标定价</th>{simulatedPrice && <th className="px-6 py-4 font-bold text-orange-600 text-right">模拟对比</th>}<th className="px-6 py-4 font-bold text-slate-500 text-right">单票利润</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredData.map((d, i) => (
                              <tr key={`${d.rate.region}-${i}`} className="hover:bg-slate-50 transition-all cursor-pointer" onClick={() => setSelectedRegion(d.rate.region)}>
                                <td className="px-6 py-4"><span className="font-semibold text-slate-800">{d.rate.region}</span><div className="text-[10px] text-slate-400 mt-1 uppercase">
                                  {d.isHeavyLogic ? "大货计费 (中转+面单)" : (d.rate.weightBuckets ? "分段计费模型" : `模型: ${d.rate.firstWeight}kg/${d.rate.addWeight}kg`)}
                                </div></td>
                                <td className="px-6 py-4 text-right font-mono text-slate-600">¥{d.shippingCost.toFixed(2)}</td>
                                <td className="px-6 py-4 text-right bg-indigo-50/5 font-bold text-indigo-600 text-base">¥{d.suggestedPrice.toFixed(2)}</td>
                                {simulatedPrice && <td className="px-6 py-4 text-right"><div className={cn("px-2 py-0.5 rounded text-[10px] font-bold inline-block", d.isMarginMet ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>{d.isMarginMet ? "达标" : "不足"}</div><div className="font-mono text-xs mt-1 text-slate-500">{(d.actualMargin!*100).toFixed(1)}%</div></td>}
                                <td className="px-6 py-4 text-right font-mono font-bold text-slate-700">¥{(simulatedPrice ? (simulatedPrice - d.totalCost) : d.profit).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-center text-slate-400/80">
                      <Calculator className="w-20 h-20 mb-6 text-slate-100" />
                      <h3 className="text-base font-bold mb-2">等待开始测算</h3>
                      <p className="text-xs max-w-xs mx-auto leading-relaxed">系统已经准备就绪。请确认左侧：<br/>1. 快递资费表已上传<br/>2. 产品成本已设置<br/>3. 点击“开启定价矩阵”</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
              {rates.length > 0 && isCalculated && (
                <div className="p-4 bg-slate-900 text-white rounded-b-2xl flex justify-between text-[11px] items-center border-t border-slate-800 font-mono">
                  <div className="flex gap-6 opacity-80"><span>基础成本: ¥{totalBaseCost.toFixed(2)}</span><span>总重: {totalWeight.toFixed(2)}kg</span><span className="text-indigo-400">毛利目标: {(product.targetMargin*100).toFixed(0)}%</span></div>
                  <div className="flex items-center gap-2 text-slate-500 select-none"><Info className="w-3 h-3" />公式: (成本+运费+杂费)/(1-目标毛利)</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
}
