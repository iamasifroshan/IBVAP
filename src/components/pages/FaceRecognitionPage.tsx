import React, { useState, useEffect, useRef } from 'react';
import { 
  UserCheck, 
  Search, 
  Plus, 
  Trash2, 
  Edit3, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Upload, 
  Fingerprint, 
  RefreshCw,
  Power,
  Layers,
  X,
  Image as ImageIcon
} from 'lucide-react';
import { Card } from '../common/Card';
import { ibvapApi } from '../../services/apiClient';
import { RegisteredPerson, FaceReference } from '../../types';
import { useApp } from '../../context/AppContext';

export const FaceRecognitionPage: React.FC = () => {
  const { setKnownPersonsCount } = useApp();
  
  // State variables
  const [people, setPeople] = useState<RegisteredPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Register Form State
  const [newName, setNewName] = useState('');
  const [newIdentityCode, setNewIdentityCode] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Edit Modal State
  const [editingPerson, setEditingPerson] = useState<RegisteredPerson | null>(null);
  const [editName, setEditName] = useState('');
  const [editIdentityCode, setEditIdentityCode] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [editIsActive, setEditIsActive] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Reference Management Modal State
  const [managingReferencesPerson, setManagingReferencesPerson] = useState<RegisteredPerson | null>(null);
  const [referencesList, setReferencesList] = useState<FaceReference[]>([]);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refImagePreview, setRefImagePreview] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [refSuccess, setRefSuccess] = useState<string | null>(null);
  const [deletingRefId, setDeletingRefId] = useState<string | null>(null);

  // Delete Confirmation State
  const [deletingPerson, setDeletingPerson] = useState<RegisteredPerson | null>(null);
  const [deleting, setDeleting] = useState(false);


  const activeRequestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Load registered people on mount
  useEffect(() => {
    isMountedRef.current = true;
    fetchPeople();
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchPeople = async () => {
    // Abort previous in-flight request if any
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {
        // no-op
      }
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const reqId = ++activeRequestIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const data = await ibvapApi.listRegisteredPeople(controller.signal);
      if (!isMountedRef.current || reqId !== activeRequestIdRef.current) return;
      setPeople(data);
      setKnownPersonsCount(data.length);
      setError(null);
    } catch (err: any) {
      if (!isMountedRef.current || reqId !== activeRequestIdRef.current) return;
      if (err.name === 'AbortError' || controller.signal.aborted) {
        // Obsolete request aborted by a newer refresh or unmount — ignore cleanly
        return;
      }
      console.error("Failed to load registered people:", err);
      setError(err.apiDetail || err.message || "FACE SERVICE OFFLINE");
    } finally {
      if (isMountedRef.current && reqId === activeRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  // Image helper
  const getImageUrl = (person: RegisteredPerson) => {
    if (!person.person_id) return '';
    // Build static URL served by FastAPI backend
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
    const origin = baseUrl.replace('/api/v1', '');
    return `${origin}/storage/faces/${person.person_id}.jpg?t=${new Date(person.updated_at || person.created_at).getTime()}`;
  };

  const getReferenceImageUrl = (ref: FaceReference) => {
    if (!ref.image_path) return '';
    if (ref.image_path.startsWith('http://') || ref.image_path.startsWith('https://') || ref.image_path.startsWith('data:')) {
      return ref.image_path;
    }
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
    const origin = baseUrl.replace('/api/v1', '');
    const filename = ref.image_path.replace(/\\/g, '/').split('/').pop();
    return `${origin}/storage/faces/${filename}?t=${new Date(ref.created_at || Date.now()).getTime()}`;
  };

  // Open Reference Management Modal
  const openManageReferences = async (person: RegisteredPerson) => {
    setManagingReferencesPerson(person);
    setRefError(null);
    setRefSuccess(null);
    setRefFile(null);
    setRefImagePreview(null);
    try {
      const refs = await ibvapApi.listFaceReferences(person.person_id);
      setReferencesList(refs);
    } catch (err: any) {
      console.error("Failed to load references:", err);
      setReferencesList([]);
    }
  };

  // Handle reference file change
  const handleRefFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRefFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setRefImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle upload new reference
  const handleUploadReferenceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingReferencesPerson || !refFile) return;

    setRefError(null);
    setRefSuccess(null);
    setUploadingRef(true);

    try {
      const formData = new FormData();
      formData.append('file', refFile);

      await ibvapApi.addFaceReference(managingReferencesPerson.person_id, formData);
      setRefSuccess("Face reference added successfully!");
      setRefFile(null);
      setRefImagePreview(null);

      // Refresh references list & people list
      const refs = await ibvapApi.listFaceReferences(managingReferencesPerson.person_id);
      setReferencesList(refs);
      await fetchPeople();

      setTimeout(() => setRefSuccess(null), 4000);
    } catch (err: any) {
      let msg = err.apiDetail || err.message || "Failed to upload reference.";
      if (msg.includes("No face detected")) {
        msg = "No face detected in the image. Please upload a clear single-person face image.";
      } else if (msg.includes("Multiple faces detected")) {
        msg = "Multiple faces detected. Please upload an image with only one person.";
      }
      setRefError(msg);
    } finally {
      setUploadingRef(false);
    }
  };

  // Handle delete reference
  const handleDeleteReference = async (refId: string) => {
    if (!managingReferencesPerson) return;

    setRefError(null);
    setRefSuccess(null);
    setDeletingRefId(refId);

    try {
      await ibvapApi.deleteFaceReference(managingReferencesPerson.person_id, refId);
      setRefSuccess("Face reference deleted successfully.");

      // Refresh references list & people list
      const refs = await ibvapApi.listFaceReferences(managingReferencesPerson.person_id);
      setReferencesList(refs);
      await fetchPeople();

      setTimeout(() => setRefSuccess(null), 4000);
    } catch (err: any) {
      setRefError(err.apiDetail || err.message || "Failed to delete reference.");
    } finally {
      setDeletingRefId(null);
    }
  };


  // Handle register file select
  const handleRegisterFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle register submission
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setSuccessMsg(null);

    if (!newName.trim()) {
      setRegisterError("Name is required.");
      return;
    }
    if (!newFile) {
      setRegisterError("Please upload a face image.");
      return;
    }

    setRegistering(true);
    try {
      const formData = new FormData();
      formData.append('name', newName.trim());
      if (newIdentityCode.trim()) {
        formData.append('identity_code', newIdentityCode.trim());
      }
      formData.append('file', newFile);

      const newPerson = await ibvapApi.registerFace(formData);
      
      // Update local state list
      setPeople(prev => [...prev, newPerson]);
      setKnownPersonsCount(prev => prev + 1);

      // Reset form
      setNewName('');
      setNewIdentityCode('');
      setNewFile(null);
      setNewImagePreview(null);
      
      setSuccessMsg(`Successfully registered ${newPerson.name}!`);
      setTimeout(() => setSuccessMsg(null), 5000);
      
      // Refetch for correctness
      await fetchPeople();
    } catch (err: any) {
      console.error("Registration error:", err);
      // Map common error detail messages to friendly UI strings
      let userFriendlyMsg = err.apiDetail || err.message || "Failed to register person.";
      if (userFriendlyMsg.includes("No face detected")) {
        userFriendlyMsg = "No face detected. Please upload a clear front-facing image.";
      } else if (userFriendlyMsg.includes("Multiple faces detected")) {
        userFriendlyMsg = "Multiple faces detected. Please upload an image containing only one person.";
      } else if (userFriendlyMsg.includes("already registered")) {
        userFriendlyMsg = "Person with this identity code is already registered.";
      }
      setRegisterError(userFriendlyMsg);
    } finally {
      setRegistering(false);
    }
  };

  // Toggle active status
  const handleToggleActive = async (person: RegisteredPerson) => {
    setError(null);
    setSuccessMsg(null);
    try {
      const formData = new FormData();
      formData.append('is_active', (!person.is_active).toString());
      
      const updated = await ibvapApi.updateRegisteredPerson(person.person_id, formData);
      setPeople(prev => prev.map(p => p.person_id === person.person_id ? updated : p));
      
      setSuccessMsg(`Successfully ${updated.is_active ? 'activated' : 'deactivated'} ${updated.name}.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error("Toggle active status error:", err);
      setError(err.apiDetail || err.message || "Failed to update status.");
    }
  };

  // Open Edit Modal
  const startEdit = (person: RegisteredPerson) => {
    setEditingPerson(person);
    setEditName(person.name);
    setEditIdentityCode(person.identity_code || '');
    setEditIsActive(person.is_active);
    setEditFile(null);
    setEditImagePreview(null);
    setUpdateError(null);
  };

  // Handle Edit file select
  const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle Edit submission
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdateError(null);
    if (!editingPerson) return;

    if (!editName.trim()) {
      setUpdateError("Name is required.");
      return;
    }

    setUpdating(true);
    try {
      const formData = new FormData();
      formData.append('name', editName.trim());
      formData.append('identity_code', editIdentityCode.trim());
      formData.append('is_active', editIsActive.toString());
      if (editFile) {
        formData.append('file', editFile);
      }

      const updated = await ibvapApi.updateRegisteredPerson(editingPerson.person_id, formData);
      
      setPeople(prev => prev.map(p => p.person_id === editingPerson.person_id ? updated : p));
      setEditingPerson(null);
      setSuccessMsg(`Successfully updated ${updated.name}.`);
      setTimeout(() => setSuccessMsg(null), 3000);
      
      await fetchPeople();
    } catch (err: any) {
      console.error("Update error:", err);
      let userFriendlyMsg = err.apiDetail || err.message || "Failed to update profile.";
      if (userFriendlyMsg.includes("No face detected")) {
        userFriendlyMsg = "No face detected. Please upload a clear front-facing image.";
      } else if (userFriendlyMsg.includes("Multiple faces detected")) {
        userFriendlyMsg = "Multiple faces detected. Please upload an image containing only one person.";
      } else if (userFriendlyMsg.includes("already registered")) {
        userFriendlyMsg = "Person with this identity code is already registered.";
      }
      setUpdateError(userFriendlyMsg);
    } finally {
      setUpdating(false);
    }
  };

  // Confirm delete
  const handleDeleteConfirm = async () => {
    if (!deletingPerson) return;
    setDeleting(true);
    try {
      await ibvapApi.deleteRegisteredPerson(deletingPerson.person_id);
      setPeople(prev => prev.filter(p => p.person_id !== deletingPerson.person_id));
      setKnownPersonsCount(prev => Math.max(0, prev - 1));
      
      setSuccessMsg(`Permanently deleted reference image and registration profile for ${deletingPerson.name}.`);
      setTimeout(() => setSuccessMsg(null), 3000);
      setDeletingPerson(null);
    } catch (err: any) {
      console.error("Delete error:", err);
      setError(err.apiDetail || err.message || "Failed to delete person.");
    } finally {
      setDeleting(false);
    }
  };

  // Filter list
  const filteredPeople = people.filter(p => {
    // Search filter
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (p.identity_code && p.identity_code.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Status filter
    if (statusFilter === 'active') return matchesSearch && p.is_active;
    if (statusFilter === 'inactive') return matchesSearch && !p.is_active;
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="p-5 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-full bg-blue-50 text-[#005EA8]">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#0B1F33] uppercase tracking-wide">
              Face Recognition / Known Persons
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Register, manage, and verify biometric profiles of authorized border guards, outposts personnel, and known targets.
            </p>
          </div>
        </div>
        <button 
          onClick={fetchPeople} 
          className="p-2 border border-slate-200 hover:bg-slate-50 rounded-md text-slate-600 transition-colors flex items-center gap-2 text-sm font-medium"
          title="Refresh List"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm font-semibold flex items-center gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="flex-1">
            <span>{error === "FACE SERVICE OFFLINE" || error.includes("500") || error.includes("unreachable") ? "FACE SERVICE OFFLINE" : error}</span>
            {(error === "FACE SERVICE OFFLINE" || error.includes("unreachable")) && (
              <p className="text-xs text-red-500 mt-1 font-normal">
                FastAPI face recognition microservice is offline or initializing. Local facial verification is temporarily suspended.
              </p>
            )}
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm font-semibold flex items-center gap-3 shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left / Middle: List (2 columns) */}
        <div className="lg:col-span-2 space-y-6">
          
          <div className="bg-white border border-slate-200 shadow-sm rounded-lg p-5">
            
            {/* Search and Filters Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or identity code..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-md py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                />
              </div>

              {/* Status Tab Filters */}
              <div className="flex bg-slate-100 p-1 rounded-md shrink-0 self-start md:self-auto">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                    statusFilter === 'all' ? 'bg-white text-[#0B1F33] shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  All ({people.length})
                </button>
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                    statusFilter === 'active' ? 'bg-white text-[#0B1F33] shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Active ({people.filter(p => p.is_active).length})
                </button>
                <button
                  onClick={() => setStatusFilter('inactive')}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                    statusFilter === 'inactive' ? 'bg-white text-[#0B1F33] shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Inactive ({people.filter(p => !p.is_active).length})
                </button>
              </div>
            </div>

            {/* List Loader / Error / Empty view */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#005EA8]" />
                <span className="text-sm font-medium">Fetching biometric database...</span>
              </div>
            ) : error && people.length === 0 ? (
              <div className="text-center py-16 border border-red-200 bg-red-50/50 rounded-lg text-red-700 p-6">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
                <h3 className="font-bold text-sm uppercase tracking-wide">Failed to load profiles</h3>
                <p className="text-xs text-red-600 mt-1 max-w-md mx-auto">{error}</p>
                <button
                  onClick={fetchPeople}
                  className="mt-4 px-4 py-2 bg-[#005EA8] hover:bg-blue-700 text-white rounded text-xs font-bold transition-colors inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry Connection
                </button>
              </div>
            ) : filteredPeople.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-slate-200 rounded-lg text-slate-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <h3 className="font-bold text-sm text-slate-700 uppercase tracking-wide">No profiles found</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {searchQuery ? "No matching records matched your query terms." : "The local biometric vault is currently empty. Register a face using the registration form."}
                </p>
              </div>
            ) : (
              // People Cards Grid
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPeople.map((person) => {
                  const hasImage = person.image_path !== '';
                  const imgUrl = getImageUrl(person);
                  
                  return (
                    <div 
                      key={person.person_id}
                      className={`p-4 border rounded-lg shadow-sm flex flex-col justify-between transition-all ${
                        person.is_active 
                          ? 'bg-white border-slate-200 hover:border-slate-300' 
                          : 'bg-slate-50 border-slate-200 opacity-75'
                      }`}
                    >
                      <div className="flex gap-4">
                        
                        {/* Profile Image Preview */}
                        <div className="w-[72px] h-[72px] rounded-md border border-slate-200 overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
                          {hasImage ? (
                            <img 
                              src={imgUrl} 
                              alt={person.name} 
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                // Fallback if image fails to load
                                (e.target as HTMLImageElement).src = '';
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : null}
                          <Fingerprint className="w-6 h-6 text-slate-300" />
                        </div>

                        {/* Person Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-[#0B1F33] truncate" title={person.name}>
                              {person.name}
                            </h3>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              person.is_active 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-slate-200 text-slate-600'
                            }`}>
                              {person.is_active ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-semibold mt-1 font-mono">
                            ID: {person.identity_code || "NO CODE"}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-[10px] font-bold text-blue-700 flex items-center gap-1">
                              <Layers className="w-3 h-3" />
                              Face References: {person.references_count || (person.references ? person.references.length : 1)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1 font-medium">
                            Registered: {new Date(person.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      {/* Vector & Action Controls Footer */}
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                        
                        {/* Vector Presence Badge */}
                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                          128-d Vector Active
                        </span>

                        {/* Actions */}
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => openManageReferences(person)}
                            className="px-2 py-1 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded text-blue-700 transition-colors flex items-center gap-1 text-[11px] font-bold"
                            title="Manage Face References"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>Manage Refs</span>
                          </button>
                          <button
                            onClick={() => handleToggleActive(person)}
                            className={`p-1.5 rounded border transition-colors ${
                              person.is_active 
                                ? 'border-slate-200 text-slate-600 hover:bg-slate-100' 
                                : 'border-slate-200 bg-[#005EA8]/10 text-[#005EA8] hover:bg-[#005EA8]/20'
                            }`}
                            title={person.is_active ? "Deactivate" : "Activate"}
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => startEdit(person)}
                            className="p-1.5 border border-slate-200 hover:bg-slate-100 rounded text-slate-600 transition-colors"
                            title="Edit Profile"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeletingPerson(person)}
                            className="p-1.5 border border-red-200 hover:bg-red-50 rounded text-red-600 transition-colors"
                            title="Delete Permanently"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>


                    </div>
                  );
                })}
              </div>
            )}

          </div>

        </div>

        {/* Right Panel: Register Form (1 column) */}
        <div>
          <div className="bg-white border border-slate-200 shadow-sm rounded-lg p-5">
            <h3 className="font-bold text-sm text-[#0B1F33] uppercase tracking-wider mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
              Register New Profile
            </h3>
            
            {registerError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center gap-2.5 mb-4">
                <AlertCircle className="w-4.5 h-4.5 text-red-600 shrink-0" />
                <span>{registerError}</span>
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              
              {/* Name */}
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">FULL NAME *</label>
                <input 
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                />
              </div>

              {/* Identity Code */}
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">IDENTITY CODE (OPTIONAL)</label>
                <input 
                  type="text"
                  value={newIdentityCode}
                  onChange={(e) => setNewIdentityCode(e.target.value)}
                  placeholder="e.g. EMP-9123"
                  className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                />
              </div>

              {/* Image Input */}
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">FACE IMAGE *</label>
                
                {/* Drag-Drop or Selector Box */}
                <div className="border-2 border-dashed border-slate-300 hover:border-[#005EA8] rounded-md p-5 bg-slate-50 transition-colors flex flex-col items-center justify-center text-center cursor-pointer relative overflow-hidden">
                  <input 
                    type="file"
                    accept="image/*"
                    required={!newFile}
                    onChange={handleRegisterFileChange}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                  />
                  
                  {newImagePreview ? (
                    <div className="w-full aspect-square max-w-[150px] border border-slate-200 rounded overflow-hidden shadow-sm">
                      <img src={newImagePreview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="p-3 bg-white border border-slate-200 rounded-full text-slate-400">
                        <Upload className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-semibold text-slate-600">Click or drag image file</span>
                      <span className="text-[10px] text-slate-400">PNG, JPG or JPEG up to 10MB</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={registering}
                className="w-full py-3 bg-[#005EA8] hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-sm mt-6"
              >
                {registering ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting Embedding...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Register Biometric Face
                  </>
                )}
              </button>

            </form>
          </div>
        </div>

      </div>

      {/* ─────────────────────────────────────────────────────────────
          EDIT PROFILE MODAL
         ───────────────────────────────────────────────────────────── */}
      {editingPerson && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl max-w-md w-full overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#0B1F33] uppercase tracking-wider">
                Edit Biometric Profile
              </h3>
              <button 
                onClick={() => setEditingPerson(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              {updateError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center gap-2.5">
                  <AlertCircle className="w-4.5 h-4.5 text-red-600 shrink-0" />
                  <span>{updateError}</span>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">FULL NAME *</label>
                <input 
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                />
              </div>

              {/* Identity Code */}
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">IDENTITY CODE</label>
                <input 
                  type="text"
                  value={editIdentityCode}
                  onChange={(e) => setEditIdentityCode(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                />
              </div>

              {/* Status Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-md">
                <span className="text-xs text-slate-600 font-bold">STATUS ACTIVE</span>
                <button
                  type="button"
                  onClick={() => setEditIsActive(!editIsActive)}
                  className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none ${
                    editIsActive ? 'bg-[#005EA8]' : 'bg-slate-300'
                  }`}
                >
                  <span className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${
                    editIsActive ? 'right-1' : 'left-1'
                  }`} />
                </button>
              </div>

              {/* Optional Reference Image Upload */}
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1.5">REPLACE FACE IMAGE (OPTIONAL)</label>
                <div className="border border-slate-300 rounded-md p-3 bg-slate-50 flex items-center justify-between">
                  <input 
                    type="file"
                    accept="image/*"
                    onChange={handleEditFileChange}
                    className="text-xs text-slate-600 focus:outline-none"
                  />
                </div>
                {editImagePreview && (
                  <div className="mt-3 w-[100px] aspect-square border border-slate-200 rounded overflow-hidden">
                    <img src={editImagePreview} alt="Edit preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingPerson(null)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded text-slate-600 font-bold text-xs uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="px-5 py-2 bg-[#005EA8] hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                >
                  {updating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Save Profile"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          DELETE CONFIRMATION DIALOG
         ───────────────────────────────────────────────────────────── */}
      {deletingPerson && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl max-w-sm w-full overflow-hidden animate-in scale-in duration-200">
            <div className="p-5 text-center">
              <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
              <h3 className="font-bold text-[#0B1F33] text-base uppercase tracking-wider">
                Confirm Delete Profile
              </h3>
              <p className="text-xs text-slate-500 mt-2">
                Are you sure you want to permanently delete <strong>{deletingPerson.name}</strong>? This will remove their 128-d face embedding vector and purge their reference image from local storage.
              </p>
              <div className="mt-2 p-2 bg-red-50 text-red-700 border border-red-100 rounded text-[10px] font-semibold uppercase tracking-wider">
                WARNING: THIS ACTION CANNOT BE UNDONE.
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button
                disabled={deleting}
                onClick={() => setDeletingPerson(null)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 rounded text-slate-600 font-bold text-xs uppercase tracking-wider transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-bold rounded text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-sm"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Purging...
                  </>
                ) : (
                  "Delete Permanently"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MANAGE FACE REFERENCES MODAL
         ───────────────────────────────────────────────────────────── */}
      {managingReferencesPerson && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm text-[#0B1F33] uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" />
                  Manage Face References — {managingReferencesPerson.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  ID: {managingReferencesPerson.identity_code || managingReferencesPerson.person_id}
                </p>
              </div>
              <button
                onClick={() => setManagingReferencesPerson(null)}
                className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* Banners */}
              {refError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{refError}</span>
                </div>
              )}
              {refSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span>{refSuccess}</span>
                </div>
              )}

              {/* Upload New Reference Form */}
              <form onSubmit={handleUploadReferenceSubmit} className="p-4 border border-blue-100 bg-blue-50/50 rounded-lg space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-blue-600" />
                  Add New Reference Image
                </h4>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                  <div className="flex-1 w-full border border-dashed border-slate-300 hover:border-blue-500 bg-white rounded-md p-3 relative cursor-pointer text-center">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleRefFileChange}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                    />
                    {refImagePreview ? (
                      <div className="flex items-center gap-3">
                        <img src={refImagePreview} alt="Preview" className="w-12 h-12 object-cover rounded border border-slate-200" />
                        <span className="text-xs font-semibold text-slate-700">{refFile?.name}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-xs text-slate-500 font-semibold py-1">
                        <Upload className="w-4 h-4 text-slate-400" />
                        <span>Select image file (single face)</span>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={!refFile || uploadingRef}
                    className="w-full sm:w-auto px-4 py-2.5 bg-[#005EA8] hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors shrink-0 shadow-sm"
                  >
                    {uploadingRef ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Add Reference
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Existing References Grid */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                  Registered References ({referencesList.length})
                </h4>

                {referencesList.length === 0 ? (
                  <div className="text-center py-6 border border-slate-200 rounded-lg text-xs text-slate-400">
                    No references found.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {referencesList.map((ref) => {
                      const refUrl = getReferenceImageUrl(ref);
                      return (
                        <div key={ref.id} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm flex flex-col justify-between p-2">
                          <div className="w-full aspect-square bg-slate-100 rounded border border-slate-200 overflow-hidden mb-2">
                            {refUrl ? (
                              <img
                                src={refUrl}
                                alt="Reference"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-300">
                                <ImageIcon className="w-8 h-8" />
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px] text-slate-500 font-mono">
                            <span>{new Date(ref.created_at).toLocaleDateString()}</span>
                            <button
                              type="button"
                              disabled={deletingRefId === ref.id}
                              onClick={() => handleDeleteReference(ref.id)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded border border-red-200 disabled:opacity-50 transition-colors"
                              title="Delete Reference"
                            >
                              {deletingRefId === ref.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setManagingReferencesPerson(null)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded text-slate-700 font-bold text-xs uppercase tracking-wider transition-colors"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};


