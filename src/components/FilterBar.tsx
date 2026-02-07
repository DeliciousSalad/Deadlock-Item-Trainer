import { hapticTap } from '../utils/haptics';
import { playCategorySound } from '../utils/sounds';

type ItemCategory = 'all' | 'weapon' | 'vitality' | 'spirit';
export type SortOption = 'default' | 'name' | 'type' | 'tier' | 'shuffled';

interface FilterBarProps {
  category: ItemCategory;
  onCategoryChange: (category: ItemCategory) => void;
  tier: number | null;
  onTierChange: (tier: number | null) => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
}

const categories: { value: ItemCategory; label: string; color: string; activeColor: string }[] = [
  { value: 'all', label: 'All', color: 'text-gray-400 hover:bg-white/10', activeColor: 'bg-white/20 text-white' },
  { value: 'weapon', label: 'Weapon', color: 'text-amber-400/70 hover:bg-amber-500/20', activeColor: 'bg-amber-500/30 text-amber-300 border-amber-500' },
  { value: 'vitality', label: 'Vitality', color: 'text-emerald-400/70 hover:bg-emerald-500/20', activeColor: 'bg-emerald-500/30 text-emerald-300 border-emerald-500' },
  { value: 'spirit', label: 'Spirit', color: 'text-violet-400/70 hover:bg-violet-500/20', activeColor: 'bg-violet-500/30 text-violet-300 border-violet-500' },
];

const tiers: { value: number | null; label: string; cost: string }[] = [
  { value: null, label: 'All', cost: '' },
  { value: 1, label: '1', cost: '500' },
  { value: 2, label: '2', cost: '1,250' },
  { value: 3, label: '3', cost: '3,000' },
  { value: 4, label: '4', cost: '6,200+' },
  { value: 5, label: '5', cost: 'Brawl' },
];

// Neutral styling for all tier buttons
const tierColor = 'text-gray-400 hover:bg-white/10';
const tierActiveColor = 'bg-white/20 text-white';

// All sort options - some may be disabled based on active filters
const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'name', label: 'A-Z' },
  { value: 'type', label: 'Type' },
  { value: 'tier', label: 'Tier' },
];

export function FilterBar({ category, onCategoryChange, tier, onTierChange, sort, onSortChange }: FilterBarProps) {
  // Determine which sort options are disabled (redundant based on active filters)
  const isTypeDisabled = category !== 'all';
  const isTierDisabled = tier !== null;
  return (
    <div className="flex flex-col gap-1 items-center px-1">
      {/* Row 1: Type + Tier */}
      <div className="flex flex-row gap-1.5 justify-center items-center flex-wrap">
        {/* Category filters */}
        <div className="flex gap-0.5 bg-black/30 p-0.5 rounded-lg items-center">
          <span className="px-1 py-0.5 text-gray-500 text-[10px] font-medium">Type:</span>
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => { 
                hapticTap(); 
                if (cat.value !== category) {
                  playCategorySound(cat.value);
                }
                onCategoryChange(cat.value); 
              }}
              className={`px-1.5 py-1 rounded-md font-semibold text-[11px] transition-all duration-200 border border-transparent
                         ${category === cat.value ? cat.activeColor : cat.color}`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Tier filters */}
        <div className="flex gap-0.5 bg-black/30 p-0.5 rounded-lg items-center">
          <span className="px-1 py-0.5 text-gray-500 text-[10px] font-medium">Tier:</span>
          {tiers.map((t) => (
            <button
              key={t.label}
              onClick={() => { hapticTap(); onTierChange(t.value); }}
              className={`px-1.5 py-1 rounded-md font-bold text-[11px] transition-all duration-200 border border-transparent
                         ${tier === t.value ? tierActiveColor : tierColor}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Sort */}
      <div className="flex gap-0.5 bg-black/30 p-0.5 rounded-lg items-center">
        <span className="px-1 py-0.5 text-gray-500 text-[10px] font-medium">Sort:</span>
        {sortOptions.map((s) => {
          const isDisabled = (s.value === 'type' && isTypeDisabled) || (s.value === 'tier' && isTierDisabled);
          return (
            <button
              key={s.value}
              disabled={isDisabled}
              onClick={() => { 
                if (!isDisabled) {
                  hapticTap(); 
                  onSortChange(s.value); 
                }
              }}
              className={`px-1.5 py-1 rounded-md font-medium text-[11px] transition-all duration-200 border border-transparent
                         ${isDisabled 
                           ? 'text-gray-600 cursor-not-allowed opacity-50' 
                           : sort === s.value 
                             ? tierActiveColor 
                             : tierColor}`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
