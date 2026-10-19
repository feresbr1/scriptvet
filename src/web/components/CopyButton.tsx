import { useState } from 'preact/hooks';

interface CopyButtonProps {
  text: string | (() => string);
  label?: string;
  class?: string;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  class: className = 'btn btn-sm',
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      class={className}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(typeof text === 'function' ? text() : text);
        setState(ok ? 'copied' : 'failed');
        setTimeout(() => setState('idle'), 1600);
      }}
    >
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </span>
    </button>
  );
}
