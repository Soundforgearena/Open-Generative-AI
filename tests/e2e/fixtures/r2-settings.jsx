import React from 'react';
import { createRoot } from 'react-dom/client';
import R2StorageSettings from '../../../components/admin/R2StorageSettings';
import '../../../app/globals.css';
const loadConnection = () => fetch('/fixture/connection').then((r) => r.json());
const connect = async (body) => {
  const response = await fetch('/fixture/connection', { method: 'POST', body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
};
createRoot(document.getElementById('root')).render(<R2StorageSettings loadConnection={loadConnection} connect={connect} />);
