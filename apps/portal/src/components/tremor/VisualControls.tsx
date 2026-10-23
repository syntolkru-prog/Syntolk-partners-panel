import {forwardRef,type ComponentPropsWithoutRef} from 'react';
import {usePartnerVisual} from './PartnerVisual.js';
import {Button} from './raw/components/Button/Button.js';
import {SelectNative} from './raw/components/SelectNative/SelectNative.js';

// Existing semantic elements, refs and handlers remain intact. Tremor supplies
// their visual contract only in the partner workspace.
export const VisualButton=forwardRef<HTMLButtonElement,ComponentPropsWithoutRef<'button'>>(function VisualButton(props,ref){
  const active=usePartnerVisual();
  const button=<button ref={ref} {...props}/>;
  return active?<Button asChild variant="ghost" className="whitespace-normal">{button}</Button>:button;
});
export const VisualSelect=forwardRef<HTMLSelectElement,ComponentPropsWithoutRef<'select'>>(function VisualSelect(props,ref){
  const active=usePartnerVisual();
  return active?<SelectNative ref={ref} {...props}/>:<select ref={ref} {...props}/>;
});
