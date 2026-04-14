import { cn } from '@/lib/utils';

interface OnboardingFieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

export function OnboardingField({ label, hint, required, error, children }: OnboardingFieldProps) {
  return (
    <div className={cn("flex flex-col gap-2", error && "error")}>
      <div className="text-sm font-semibold text-gray-900">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </div>
      {hint && <div className="text-xs text-gray-500 -mt-1 leading-relaxed">{hint}</div>}
      {children}
      {error && <div className="text-xs font-medium text-red-500">{error}</div>}
    </div>
  );
}

interface CheckboxGridProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columns?: number;
  withOther?: boolean;
  otherValue?: string;
  onOtherChange?: (val: string) => void;
}

export function CheckboxGrid({ options, selected, onChange, columns = 2, withOther, otherValue, onOtherChange }: CheckboxGridProps) {
  const toggle = (val: string) => {
    onChange(
      selected.includes(val)
        ? selected.filter(v => v !== val)
        : [...selected, val]
    );
  };

  return (
    <div className={cn("grid gap-2.5", columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
      {options.map(opt => (
        <label
          key={opt}
          className={cn(
            "flex items-center gap-2.5 px-3.5 py-2.5 bg-gray-50 border-[1.5px] rounded-lg cursor-pointer transition-all text-sm font-medium text-gray-700 select-none",
            selected.includes(opt) ? "border-[#3CAB7A] bg-[#EAF7F1]" : "border-transparent hover:border-[#3CAB7A] hover:bg-[#EAF7F1]"
          )}
        >
          <input
            type="checkbox"
            checked={selected.includes(opt)}
            onChange={() => toggle(opt)}
            className="accent-[#3CAB7A] w-4 h-4 shrink-0"
          />
          {opt}
        </label>
      ))}
      {withOther && (
        <div className={cn(
          "col-span-full flex items-center gap-2.5 px-3.5 py-2.5 bg-gray-50 border-[1.5px] rounded-lg transition-all",
          otherValue ? "border-[#3CAB7A] bg-[#EAF7F1]" : "border-transparent focus-within:border-[#3CAB7A]"
        )}>
          <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Other:</span>
          <input
            type="text"
            value={otherValue || ''}
            onChange={e => onOtherChange?.(e.target.value)}
            placeholder="Specify..."
            className="bg-transparent border-none outline-none text-sm flex-1 min-w-0"
          />
        </div>
      )}
    </div>
  );
}

interface RadioGroupProps {
  options: string[];
  value: string | null;
  onChange: (val: string) => void;
}

export function RadioGroup({ options, value, onChange }: RadioGroupProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {options.map(opt => (
        <label
          key={opt}
          className={cn(
            "flex items-center gap-2.5 px-3.5 py-2.5 bg-gray-50 border-[1.5px] rounded-lg cursor-pointer transition-all text-sm font-medium text-gray-700 select-none",
            value === opt ? "border-[#3CAB7A] bg-[#EAF7F1]" : "border-transparent hover:border-[#3CAB7A] hover:bg-[#EAF7F1]"
          )}
        >
          <input
            type="radio"
            checked={value === opt}
            onChange={() => onChange(opt)}
            className="accent-[#3CAB7A] w-4 h-4 shrink-0"
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

export function OnboardingTextInput({ value, onChange, placeholder, ...props }: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  [key: string]: any;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full font-['Inter'] text-sm text-gray-900 bg-gray-50 border-[1.5px] border-gray-300 rounded-lg px-4 py-3 outline-none transition-all focus:border-[#3CAB7A] focus:bg-white placeholder:text-gray-300"
      {...props}
    />
  );
}

export function OnboardingTextarea({ value, onChange, placeholder, ...props }: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  [key: string]: any;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full font-['Inter'] text-sm text-gray-900 bg-gray-50 border-[1.5px] border-gray-300 rounded-lg px-4 py-3 outline-none transition-all focus:border-[#3CAB7A] focus:bg-white placeholder:text-gray-300 resize-y min-h-[100px]"
      {...props}
    />
  );
}

export function FieldDivider() {
  return <div className="h-px bg-gray-100" />;
}
