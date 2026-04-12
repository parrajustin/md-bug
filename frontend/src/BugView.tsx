import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Breadcrumbs, 
  Link, 
  Paper, 
  Grid, 
  TextField, 
  Button, 
  Select, 
  MenuItem, 
  Divider, 
  Chip, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions,
  IconButton,
  Tooltip,
  Stack,
  FormControl,
  InputLabel
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import { type Bug, type Comment, get_api } from './api/api';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { WrapToResult } from 'standard-ts-lib/src/wrap_to_result';

// Declare Temporal globally if it's not yet in the TypeScript definitions
declare const Temporal: any;
declare const DEBUG_MODE: boolean;

interface BugViewProps {
  bug: Bug;
  onHome: () => void;
  onRefresh: (id: number, updatedBug?: Bug) => void;
  onSearch: (query: string) => void;
  username: string;
}

const BugView: React.FC<BugViewProps> = ({ bug: initialBug, onHome, onRefresh, onSearch, username }) => {
  const [bug, setBug] = useState<Bug>(initialBug);
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [hasFullAccess, setHasFullAccess] = useState(false);
  const [hasCommentAccess, setHasCommentAccess] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  const [editTitle, setEditTitle] = useState(initialBug.title);
  const [editDescription, setEditDescription] = useState(initialBug.metadata.description);

  // Debugging: Log the bug data to console in debug mode
  useEffect(() => {
    if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
      console.log('BugView data:', bug);
    }
  }, [bug]);

  // Synchronize local state when the bug prop changes (e.g., from a refresh)
  useEffect(() => {
    setBug(initialBug);
    setEditTitle(initialBug.title);
    setEditDescription(initialBug.metadata.description);
  }, [initialBug]);

  // Determine access levels
  useEffect(() => {
    const checkAccess = async () => {
      // Initial checks based on bug metadata
      let full = bug.metadata.access.full_access.includes(username) || bug.metadata.access.full_access.includes('PUBLIC');
      let comment = full || bug.metadata.access.comment_access.includes(username) || bug.metadata.access.comment_access.includes('PUBLIC');
      
      // Check component-level permissions
      const apiResult = get_api();
      if (apiResult.ok) {
        const compRes = await apiResult.val.get_component_metadata(username, bug.metadata.component_id);
        if (compRes.ok) {
          const compMeta = compRes.val;
          for (const group of Object.values(compMeta.access_control.groups)) {
            const isMember = group.members.includes(username) || group.members.includes('PUBLIC');
            if (isMember) {
              if (group.permissions.includes('AdminIssues') || group.permissions.includes('EditIssues')) {
                full = true;
                comment = true;
              }
              if (group.permissions.includes('CommentOnIssues')) {
                comment = true;
              }
            }
          }
        }
      }
      
      setHasFullAccess(full);
      setHasCommentAccess(comment);
    };
    checkAccess();
  }, [bug, username]);

  // Handle scrolling to comment if hash is present
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#comment')) {
      const targetId = hash.substring(1);
      let retries = 0;
      
      const scrollAttempt = () => {
        const element = document.getElementById(targetId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        } else if (retries < 10) {
          retries++;
          requestAnimationFrame(scrollAttempt);
        }
      };
      
      scrollAttempt();
    }
  }, [bug]);

  const renderMarkdown = (content: string) => {
    const rawHtml = marked.parse(content) as string;
    return { __html: DOMPurify.sanitize(rawHtml, { RETURN_TRUSTED_TYPE: true }) as unknown as string };
  };

  const formatTemporalDate = (nanos: bigint) => {
    const result = WrapToResult(
      () => {
        const instant = Temporal.Instant.fromEpochNanoseconds(nanos);
        return new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).format(instant);
      },
      'Failed to format temporal date'
    );

    if (result.ok) {
      return result.val;
    } else {
      console.error(result.val.toString());
      return nanos.toString();
    }
  };

  const handleMetadataChange = async (field: string, value: string) => {
    const apiResult = get_api();
    if (!apiResult.ok) return;

    const result = await apiResult.val.update_bug_metadata(username, bug.id, field, value);
    if (result.ok) {
      onRefresh(bug.id);
    } else {
      alert(`Failed to update ${field}: ` + result.val.message);
    }
  };

  const handleCommentSubmit = async () => {
    if (!commentText.trim()) return;

    const apiResult = get_api();
    if (!apiResult.ok) return;

    setIsSubmitting(true);
    const result = await apiResult.val.submit_comment(username, bug.id, username, commentText);
    
    if (result.ok) {
      const response = result.val;
      
      if (response.state_id === bug.state_id + 1n) {
        const newComment: Comment = {
          version: 1,
          id: response.comment_id,
          author: username,
          epoch_nanoseconds: BigInt(Date.now()) * 1000000n,
          content: commentText,
        };

        const updatedBug = {
          ...bug,
          comments: [...bug.comments, newComment],
          state_id: response.state_id,
        };
        setBug(updatedBug);
        onRefresh(bug.id, updatedBug);
      } else {
        const fullBugResult = await apiResult.val.get_bug(username, bug.id);
        if (fullBugResult.ok) {
          setBug(fullBugResult.val);
          onRefresh(bug.id, fullBugResult.val);
        }
      }
      setCommentText('');
    } else {
      alert('Failed to submit comment: ' + result.val.message);
    }
    setIsSubmitting(false);
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 1 }}>
          {bug.folders.map((folder, index) => (
            <Link 
              key={index} 
              underline="hover" 
              color="inherit" 
              component="button"
              onClick={() => onSearch(`componentid:${bug.folder_ids[index]}`)}
              sx={{ verticalAlign: 'baseline', fontSize: 'inherit' }}
            >
              {folder}
            </Link>
          ))}
          <Typography color="text.secondary">{bug.id}</Typography>
        </Breadcrumbs>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Tooltip title="Back">
            <IconButton onClick={onHome} size="small">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Refresh">
            <IconButton onClick={() => onRefresh(bug.id)} size="small">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          
          {hasFullAccess ? (
            <TextField
              variant="standard"
              fullWidth
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => editTitle !== bug.title && handleMetadataChange('title', editTitle)}
              InputProps={{
                style: { fontSize: '1.5rem', fontWeight: 500 }
              }}
            />
          ) : (
            <Typography variant="h5" sx={{ fontWeight: 500 }}>{bug.title}</Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack spacing={2}>
            {/* Description / First Comment */}
            <Paper variant="outlined" sx={{ p: 2, borderLeft: 4, borderLeftColor: 'primary.main' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  <strong>{bug.metadata.reporter}</strong> created the issue · {formatTemporalDate(bug.metadata.created_at)}
                </Typography>
                {hasFullAccess && !isEditingDescription && (
                  <Tooltip title="Edit Description">
                    <IconButton size="small" onClick={() => setIsEditingDescription(true)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              
              {isEditingDescription ? (
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <TextField
                    fullWidth
                    multiline
                    minRows={6}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    sx={{ '& .MuiInputBase-root': { bgcolor: 'rgba(0,0,0,0.2)', fontFamily: 'monospace' } }}
                  />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button 
                      variant="contained" 
                      size="small"
                      onClick={() => {
                        handleMetadataChange('description', editDescription);
                        setIsEditingDescription(false);
                      }}
                    >
                      Submit Description
                    </Button>
                    <Button 
                      variant="outlined" 
                      size="small"
                      onClick={() => {
                        setEditDescription(bug.metadata.description);
                        setIsEditingDescription(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </Box>
                </Stack>
              ) : (
                <Box 
                  className="description-content" 
                  dangerouslySetInnerHTML={renderMarkdown(bug.metadata.description)} 
                  sx={{ '& p': { m: 0 } }}
                />
              )}
            </Paper>

            {/* Comments */}
            {bug.comments.map((comment) => (
              <Paper key={comment.id} id={`comment${comment.id}`} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    <strong>{comment.author}</strong> commented · {formatTemporalDate(comment.epoch_nanoseconds)}
                  </Typography>
                  <Link href={`#comment${comment.id}`} variant="caption" sx={{ textDecoration: 'none' }}>
                    #{comment.id}
                  </Link>
                </Box>
                <Box dangerouslySetInnerHTML={renderMarkdown(comment.content)} />
              </Paper>
            ))}

            {/* New Comment Input */}
            {hasCommentAccess && (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.paper' }}>
                <Typography variant="subtitle2" gutterBottom>Add a comment</Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={4}
                  placeholder="Add a comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  sx={{ '& .MuiInputBase-root': { bgcolor: 'rgba(0,0,0,0.1)' } }}
                />
                <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
                  <Button 
                    variant="contained" 
                    onClick={handleCommentSubmit} 
                    disabled={isSubmitting || !commentText.trim()}
                  >
                    {isSubmitting ? 'Submitting...' : 'Comment'}
                  </Button>
                </Box>
                
                {commentText && (
                  <Box sx={{ mt: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Preview</Typography>
                    <Box dangerouslySetInnerHTML={renderMarkdown(commentText)} />
                  </Box>
                )}
              </Paper>
            )}
          </Stack>
        </Box>

        {/* Sidebar Metadata */}
        <Box sx={{ width: { xs: '100%', md: 350 }, flexShrink: 0 }}>
          <Paper variant="outlined" sx={{ p: 2, position: 'sticky', top: 88 }}>
            <Typography variant="h6" gutterBottom>Metadata</Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="caption" color="text.secondary">Reporter</Typography>
                <Typography variant="body2">{bug.metadata.reporter}</Typography>
              </Box>

              {[
                { label: 'Status', field: 'status', options: ['New', 'Assigned', 'Fixed', 'Verified', 'Duplicate', 'WontFix'] },
                { label: 'Priority', field: 'priority', options: ['P0', 'P1', 'P2', 'P3', 'P4'] },
                { label: 'Severity', field: 'severity', options: ['S0', 'S1', 'S2', 'S3', 'S4'] },
                { label: 'Type', field: 'type', options: ['Bug', 'Feature', 'Task'] },
              ].map((meta) => (
                <Box key={meta.field}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{meta.label}</Typography>
                  {hasFullAccess ? (
                    <Select
                      size="small"
                      fullWidth
                      value={(bug.metadata as any)[meta.field === 'type' ? 'bug_type' : meta.field]}
                      onChange={(e) => handleMetadataChange(meta.field, e.target.value)}
                    >
                      {meta.options.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                    </Select>
                  ) : (
                    <Chip 
                      label={(bug.metadata as any)[meta.field === 'type' ? 'bug_type' : meta.field]} 
                      size="small" 
                      color={meta.field === 'status' ? 'primary' : 'default'} 
                    />
                  )}
                </Box>
              ))}

              {[
                { label: 'Assignee', field: 'assignee' },
                { label: 'Verifier', field: 'verifier' },
                { label: 'Collaborators', field: 'collaborators', isArray: true },
                { label: 'CC', field: 'cc', isArray: true },
              ].map((meta) => (
                <Box key={meta.field}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{meta.label}</Typography>
                  {hasFullAccess ? (
                    <TextField
                      size="small"
                      fullWidth
                      defaultValue={meta.isArray ? (bug.metadata as any)[meta.field].join(', ') : (bug.metadata as any)[meta.field]}
                      onBlur={(e) => {
                        const oldVal = meta.isArray ? (bug.metadata as any)[meta.field].join(', ') : (bug.metadata as any)[meta.field];
                        if (e.target.value !== oldVal) handleMetadataChange(meta.field, e.target.value);
                      }}
                    />
                  ) : (
                    <Typography variant="body2">
                      {meta.isArray ? ((bug.metadata as any)[meta.field].join(', ') || 'None') : ((bug.metadata as any)[meta.field] || 'None')}
                    </Typography>
                  )}
                </Box>
              ))}

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Access Control</Typography>
                <Link component="button" variant="body2" onClick={() => setShowAccessModal(true)}>
                  Manage Access
                </Link>
              </Box>

              {bug.metadata.user_metadata.length > 0 && (
                <>
                  <Divider />
                  <Typography variant="subtitle2">User Metadata</Typography>
                  {bug.metadata.user_metadata.map((entry) => (
                    <Box key={entry.key}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{entry.key}</Typography>
                      {hasFullAccess ? (
                        <TextField
                          size="small"
                          fullWidth
                          defaultValue={entry.value}
                          onBlur={(e) => e.target.value !== entry.value && handleMetadataChange(entry.key, e.target.value)}
                        />
                      ) : (
                        <Typography variant="body2">{entry.value}</Typography>
                      )}
                    </Box>
                  ))}
                </>
              )}
            </Stack>
          </Paper>
        </Box>
      </Box>

      {/* Access Control Modal */}
      <Dialog open={showAccessModal} onClose={() => setShowAccessModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Access Control
          <IconButton onClick={() => setShowAccessModal(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} sx={{ mt: 1 }}>
            {[
              { label: 'Full Access (Edit, Comment, View)', field: 'full_access' },
              { label: 'Comment Access (Comment, View)', field: 'comment_access' },
              { label: 'View Access', field: 'view_access' },
            ].map((perm) => (
              <Box key={perm.field}>
                <Typography variant="subtitle2" gutterBottom>{perm.label}</Typography>
                {hasFullAccess ? (
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    placeholder="user1, user2, PUBLIC"
                    defaultValue={(bug.metadata.access as any)[perm.field].join(', ')}
                    onBlur={(e) => {
                      const oldVal = (bug.metadata.access as any)[perm.field].join(', ');
                      if (e.target.value !== oldVal) handleMetadataChange(perm.field, e.target.value);
                    }}
                  />
                ) : (
                  <Paper variant="outlined" sx={{ p: 1, bgcolor: 'rgba(0,0,0,0.1)' }}>
                    <Typography variant="body2">{(bug.metadata.access as any)[perm.field].join(', ') || 'None'}</Typography>
                  </Paper>
                )}
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAccessModal(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BugView;
