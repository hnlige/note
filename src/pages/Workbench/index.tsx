import React from 'react';
import { MainLayout } from '../../components/Layout/MainLayout';
import { ActionBar } from './components/ActionBar';
import { MetricCards } from './components/MetricCards';
import { TaskList } from './components/TaskList';

const Workbench: React.FC = () => {
  return (
    <MainLayout>
      <ActionBar />
      <MetricCards />
      <TaskList />
    </MainLayout>
  );
};

export default Workbench;
