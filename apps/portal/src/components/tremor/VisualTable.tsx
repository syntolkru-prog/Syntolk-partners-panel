import type { ComponentPropsWithoutRef } from 'react';
import { usePartnerVisual } from './PartnerVisual.js';
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from './raw/components/Table/Table.js';

// Keep every existing table prop, cell, sorting handler and expanded row.
export function VisualTable(props:ComponentPropsWithoutRef<'table'>){const active=usePartnerVisual();return active?<Table {...props}/>:<table {...props}/>;}
export function VisualTableHead(props:ComponentPropsWithoutRef<'thead'>){const active=usePartnerVisual();return active?<TableHead {...props}/>:<thead {...props}/>;}
export function VisualTableHeader(props:ComponentPropsWithoutRef<'th'>){const active=usePartnerVisual();return active?<TableHeaderCell {...props}/>:<th {...props}/>;}
export function VisualTableBody(props:ComponentPropsWithoutRef<'tbody'>){const active=usePartnerVisual();return active?<TableBody {...props}/>:<tbody {...props}/>;}
export function VisualTableRow(props:ComponentPropsWithoutRef<'tr'>){const active=usePartnerVisual();return active?<TableRow {...props}/>:<tr {...props}/>;}
export function VisualTableCell(props:ComponentPropsWithoutRef<'td'>){const active=usePartnerVisual();return active?<TableCell {...props}/>:<td {...props}/>;}
