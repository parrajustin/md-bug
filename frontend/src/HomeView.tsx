import React, { useState, useEffect } from 'react';
import { get_api, type BugSummary, type ComponentSummary } from './api/api';

interface HomeViewProps {
  onBugSelect: (id: number) => void;
  username: string;
}

const HomeView: React.FC<HomeViewProps> = ({ onBugSelect, username }) => {
  const [bugs, setBugs] = useState<BugSummary[]>([]);
  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const apiResult = get_api();
      if (apiResult.ok) {
        const [bugsResult, compsResult] = await Promise.all([
          apiResult.val.get_bug_list(username),
          apiResult.val.get_component_list(username)
        ]);

        if (bugsResult.ok) {
          setBugs(bugsResult.val);
        } else {
          setError(bugsResult.val.message);
        }

        if (compsResult.ok) {
          setComponents(compsResult.val);
        }
      } else {
        setError("API not available");
      }
      setLoading(false);
    };

    fetchData();
  }, [username]);

  const formatComponentPath = (c: ComponentSummary) => {
    if (c.folders.length === 0) return c.name;
    return c.folders.join(' > ') + ' > ' + c.name;
  };

  if (loading) {
    return (
      <div className="loading-view" style={{ padding: '20px', color: 'white' }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-view" style={{ padding: '20px', color: '#ff4d4d' }}>
        <h2>Error Loading Data</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="home-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="card">
        <div className="card-header">
          <h2>All Bugs</h2>
        </div>
        <div className="bug-list" style={{ maxHeight: '500px', overflowY: 'auto' }}>
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

      <div className="card">
        <div className="card-header">
          <h2>Components</h2>
        </div>
        <div className="component-list" style={{ padding: '10px' }}>
          {components.length === 0 && <div style={{ color: '#888' }}>No components found.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {components.map((comp) => (
              <div 
                key={comp.id} 
                style={{ 
                  padding: '8px 12px', 
                  backgroundColor: '#1e1e1e', 
                  borderRadius: '4px', 
                  border: '1px solid #333',
                  color: '#ccc',
                  cursor: 'default'
                }}
              >
                {formatComponentPath(comp)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomeView;
