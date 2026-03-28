import type { NodeColors } from '@/types';

// Node dimensions
export const NODE_W = 190;
export const NODE_H = 80;

// Layout spacing
export const H_GAP = 20;
export const V_GAP = 110;

// Core node kinds to display
export const CORE_KINDS = new Set([
  'route_handler',
  'middleware',
  'business_logic',
  'transformer',
  'validator',
  'db_call',
  'external_http_call',
  'function',
  'background_process',
  'classifier',
  'decision',
  'generator',
  'polling_task',
  'cli_command',
]);

// Node kind colors
export const KIND_COLORS: Record<string, NodeColors> = {
  route_handler: {
    bg: '#0e1e30',
    border: '#185FA5',
    badgeBg: '#B5D4F4',
    badgeText: '#0C447C',
  },
  middleware: {
    bg: '#1a0e2e',
    border: '#534AB7',
    badgeBg: '#CECBF6',
    badgeText: '#3C3489',
  },
  business_logic: {
    bg: '#0e1e0e',
    border: '#3B6D11',
    badgeBg: '#C0DD97',
    badgeText: '#27500A',
  },
  transformer: {
    bg: '#1e1200',
    border: '#854F0B',
    badgeBg: '#FAC775',
    badgeText: '#633806',
  },
  validator: {
    bg: '#1e0e00',
    border: '#993C1D',
    badgeBg: '#F5C4B3',
    badgeText: '#712B13',
  },
  db_call: {
    bg: '#001e18',
    border: '#0F6E56',
    badgeBg: '#9FE1CB',
    badgeText: '#085041',
  },
  external_http_call: {
    bg: '#1a1000',
    border: '#B37F00',
    badgeBg: '#FFE28A',
    badgeText: '#7A5500',
  },
  function: {
    bg: '#111118',
    border: '#4A5568',
    badgeBg: '#CBD5E0',
    badgeText: '#2D3748',
  },
  background_process: {
    bg: '#1a0d14',
    border: '#9B3060',
    badgeBg: '#F0A0C0',
    badgeText: '#72164A',
  },
  classifier: {
    bg: '#0e1e1e',
    border: '#0F8B8D',
    badgeBg: '#A0E7E5',
    badgeText: '#0D5F61',
  },
  decision: {
    bg: '#1e0e1e',
    border: '#9B3060',
    badgeBg: '#E8B4D8',
    badgeText: '#6B1F4A',
  },
  generator: {
    bg: '#0e1e0e',
    border: '#2D5016',
    badgeBg: '#B8E6A0',
    badgeText: '#1F3A0A',
  },
  polling_task: {
    bg: '#1a0d0e',
    border: '#8B3A3A',
    badgeBg: '#E8B4B4',
    badgeText: '#5C2626',
  },
  cli_command: {
    bg: '#0e1a1e',
    border: '#1E5A7A',
    badgeBg: '#A8D5E8',
    badgeText: '#0D3A52',
  },
};

// Node kind labels
export const KIND_LABELS: Record<string, string> = {
  route_handler: 'ROUTE',
  middleware: 'MIDDLEWARE',
  business_logic: 'HANDLER',
  transformer: 'TRANSFORM',
  validator: 'VALIDATOR',
  db_call: 'DB',
  external_http_call: 'EXT HTTP',
  function: 'FUNC',
  background_process: 'WORKER',
  classifier: 'CLASSIFY',
  decision: 'DECIDE',
  generator: 'GENERATE',
  polling_task: 'POLL',
  cli_command: 'CLI',
};
