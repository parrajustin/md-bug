import React, { useState, useEffect } from 'react';
import { get_api, type BugSummary } from './api/api';

interface HomeViewProps {
  onBugSelect: (id: number) => void;
  username: string;
}

const HomeView: React.FC<HomeViewProps> = ({ onBugSelect, username }) => {
  const [bugs, setBugs] = useState<BugSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBugs = async () => {
      const apiResult = get_api();
      if (apiResult.ok) {
        const result = await apiResult.val.get_bug_list(username);
        if (result.ok) {
          setBugs(result.val);
        } else {
          setError(result.val.message);
        }
      } else {
        setError("API not available");
      }
      setLoading(false);
    };

    fetchBugs();
  }, [username]);

  if (loading) {
    return (
      <div className="loading-view" style={{ padding: '20px', color: 'white' }}>
        Loading bugs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-view" style={{ padding: '20px', color: '#ff4d4d' }}>
        <h2>Error Loading Bugs</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="home-view">
      <div className="card">
        <div className="card-header">
          <h2>All Bugs</h2>
        </div>
        <div className="bug-list">
          <div className="bug-list-header">
            <div className="bug-id-col">ID</div>
            <div className="bug-title-col">Title</div>
          </div>
          {bugs.map((bug) => (
            <div 
              key={bug.id} 
              className="bug-list-row" 
              onClick={() => onBugSelect(bug.id)}
            >
              <div className="bug-id-col">{bug.id}</div>
              <div className="bug-title-col">{bug.title}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HomeView;
