import React, { useState, useEffect, useMemo, useRef } from 'react';
import { get_api, type BugSummary, type ComponentSummary } from './api/api';

interface HomeViewProps {
  onBugSelect: (id: number) => void;
  username: string;
}

type SortKey = keyof BugSummary;

interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

interface VisibleColumns {
  id: boolean;
  title: boolean;
  status: boolean;
  priority: boolean;
  severity: boolean;
  type: boolean;
  description: boolean;
  created_at: boolean;
  last_updated_at: boolean;
}

const HomeView: React.FC<HomeViewProps> = ({ onBugSelect, username }) => {
  const [bugs, setBugs] = useState<BugSummary[]>([]);
  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'last_updated_at', direction: 'desc' });
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>({
    id: true,
    title: true,
    status: true,
    priority: true,
    severity: false,
    type: false,
    description: false,
    created_at: false,
    last_updated_at: true
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sortedBugs = useMemo(() => {
    const sortableBugs = [...bugs];
    sortableBugs.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    return sortableBugs;
  }, [bugs, sortConfig]);

  const requestSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const toggleColumn = (col: keyof VisibleColumns) => {
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));
  };

  const formatComponentPath = (c: ComponentSummary) => {
    if (c.folders.length === 0) return c.name;
    return c.folders.join(' > ') + ' > ' + c.name;
  };

  const formatTimestamp = (ts: bigint) => {
    const ms = Number(ts / 1000000n);
    return new Date(ms).toLocaleString();
  };

  const getSortIcon = (key: SortKey) => {
    if (sortConfig.key !== key) return <span className="sort-icon">↕</span>;
    return sortConfig.direction === 'asc' ? 
      <span className="sort-icon active">↑</span> : 
      <span className="sort-icon active">↓</span>;
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
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>All Bugs</h2>
          <div className="dropdown" ref={menuRef}>
            <button className="dropdown-toggle" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              ⋮
            </button>
            {isMenuOpen && (
              <div className="dropdown-menu">
                <div className="submenu-container">
                  <div className="dropdown-item">
                    Show <span>▶</span>
                  </div>
                  <div className="submenu">
                    {(Object.keys(visibleColumns) as Array<keyof VisibleColumns>).map(col => (
                      <div key={col} className="check-item" onClick={() => toggleColumn(col)}>
                        <input 
                          type="checkbox" 
                          checked={visibleColumns[col]} 
                          onChange={() => {}} 
                          onClick={(e) => e.stopPropagation()} 
                        />
                        <span style={{ textTransform: 'capitalize' }}>
                          {col.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="bug-list" style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <div className="bug-list-header">
            {visibleColumns.id && (
              <div className="bug-id-col sortable-header" onClick={() => requestSort('id')}>
                ID {getSortIcon('id')}
              </div>
            )}
            {visibleColumns.title && (
              <div className="bug-title-col sortable-header" onClick={() => requestSort('title')}>
                Title {getSortIcon('title')}
              </div>
            )}
            {visibleColumns.status && (
              <div className="col-small sortable-header" onClick={() => requestSort('status')}>
                Status {getSortIcon('status')}
              </div>
            )}
            {visibleColumns.priority && (
              <div className="col-tiny sortable-header" onClick={() => requestSort('priority')}>
                Pri {getSortIcon('priority')}
              </div>
            )}
            {visibleColumns.severity && (
              <div className="col-tiny sortable-header" onClick={() => requestSort('severity')}>
                Sev {getSortIcon('severity')}
              </div>
            )}
            {visibleColumns.type && (
              <div className="col-small sortable-header" onClick={() => requestSort('type')}>
                Type {getSortIcon('type')}
              </div>
            )}
            {visibleColumns.description && (
              <div className="bug-title-col sortable-header" onClick={() => requestSort('description')}>
                Description {getSortIcon('description')}
              </div>
            )}
            {visibleColumns.created_at && (
              <div className="col-timestamp sortable-header" onClick={() => requestSort('created_at')}>
                Created {getSortIcon('created_at')}
              </div>
            )}
            {visibleColumns.last_updated_at && (
              <div className="col-timestamp sortable-header" onClick={() => requestSort('last_updated_at')}>
                Updated {getSortIcon('last_updated_at')}
              </div>
            )}
          </div>
          {sortedBugs.map((bug) => (
            <div 
              key={bug.id} 
              className="bug-list-row" 
              onClick={() => onBugSelect(bug.id)}
            >
              {visibleColumns.id && <div className="bug-id-col">{bug.id}</div>}
              {visibleColumns.title && <div className="bug-title-col">{bug.title}</div>}
              {visibleColumns.status && <div className="col-small">{bug.status}</div>}
              {visibleColumns.priority && <div className="col-tiny">{bug.priority}</div>}
              {visibleColumns.severity && <div className="col-tiny">{bug.severity}</div>}
              {visibleColumns.type && <div className="col-small">{bug.type}</div>}
              {visibleColumns.description && <div className="bug-title-col col-description">{bug.description}</div>}
              {visibleColumns.created_at && <div className="col-timestamp">{formatTimestamp(bug.created_at)}</div>}
              {visibleColumns.last_updated_at && <div className="col-timestamp">{formatTimestamp(bug.last_updated_at)}</div>}
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
