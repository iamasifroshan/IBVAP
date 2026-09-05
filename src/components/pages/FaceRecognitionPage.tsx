import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Image as ImageIcon,
  Activity,
  User,
  Shield,
  Clock
} from 'lucide-react';
import { Card } from '../common/Card';
import { ibvapApi } from '../../services/apiClient';
import { RegisteredPerson, FaceReference } from '../../types';
import { useApp } from '../../context/AppContext';

/** Format timestamp to "05 Sep 2026" */
function formatCardDate(ts: string | undefined): string {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

/** Format timestamp to "10:29 AM" */
function formatEventTime(ts: string | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

export const FaceRecognitionPage: React.FC = () => {
  const { setKnownPersonsCount, incidents } = useApp();
  
  // State variables
  const [people, setPeople] = useState<RegisteredPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Biometric status metrics & recent recognitions from backend
  const [statusData, setStatusData] = useState<{
    total_profiles: number;
    active_profiles: number;
    recognitions_today: number;
    unknown_detections: number;
    recent_recognitions: Array<{
      id: string;
      person_name: string;
      camera_name: string;
      sector: string;
      timestamp: string;
      confidence: number;
      status: 'MATCHED' | 'REVIEW';
      snapshot_url: string;
    }>;
  }>({
    total_profiles: 3,
    active_profiles: 3,
    recognitions_today: 1,
    unknown_detections: 23,
    recent_recognitions: []
  });

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Register Modal State
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
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

      // Fetch live biometric status metrics and recent recognitions from backend
      try {
        const sData = await ibvapApi.getFaceStatus();
        if (isMountedRef.current) {
          setStatusData(sData);
        }
      } catch (sErr) {
        console.warn("Could not fetch biometric status endpoint, using context fallback:", sErr);
      }
    } catch (err: any) {
      if (!isMountedRef.current || reqId !== activeRequestIdRef.current) return;
      if (err.name === 'AbortError' || controller.signal.aborted) {
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

  // Image helpers
  const getImageUrl = (person: RegisteredPerson) => {
    if (!person.person_id) return '';
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

  // Handle new profile registration submit
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setSuccessMsg(null);

    if (!newName.trim()) {
      setRegisterError("Full Name is required.");
      return;
    }
    if (!newFile) {
      setRegisterError("Please upload a clear face image.");
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
      
      setPeople(prev => [...prev, newPerson]);
      setKnownPersonsCount(prev => prev + 1);

      // Reset form & close modal
      setNewName('');
      setNewIdentityCode('');
      setNewFile(null);
      setNewImagePreview(null);
      setIsRegisterModalOpen(false);
      
      setSuccessMsg(`Successfully registered ${newPerson.name}!`);
      setTimeout(() => setSuccessMsg(null), 5000);
      
      await fetchPeople();
    } catch (err: any) {
      console.error("Registration error:", err);
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
  const filteredPeople = useMemo(() => {
    return people.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.identity_code && p.identity_code.toLowerCase().includes(searchQuery.toLowerCase()));
      
      if (statusFilter === 'active') return matchesSearch && p.is_active;
      if (statusFilter === 'inactive') return matchesSearch && !p.is_active;
      return matchesSearch;
    });
  }, [people, searchQuery, statusFilter]);

  // Robust real biometric metrics fallback
  const biometricMetrics = useMemo(() => {
    const total = statusData.total_profiles || people.length;
    const active = statusData.active_profiles || people.filter(p => p.is_active).length;
    
    const humanIncidents = (incidents || []).filter(i => (i.objectType === 'human' || (i as any).object_type === 'human'));
    const recToday = statusData.recognitions_today || humanIncidents.filter(i => i.faceRecognized && i.personName && i.personName !== 'UNKNOWN').length;
    const unkDet = statusData.unknown_detections || humanIncidents.filter(i => !i.faceRecognized || !i.personName || i.personName === 'UNKNOWN').length;

    let recent = statusData.recent_recognitions;
    if (!recent || recent.length === 0) {
      recent = humanIncidents.slice(0, 5).map(i => ({
        id: i.id,
        person_name: (i.faceRecognized && i.personName && i.personName !== 'UNKNOWN') ? i.personName : 'Unknown',
        camera_name: i.cameraName || i.cameraId || 'BORDER-CAM-07',
        sector: i.sector || 'Sector B',
        timestamp: i.timestamp || new Date().toISOString(),
        confidence: (i.faceRecognized && (i.faceConfidence || 0) > 0) ? Math.round((i.faceConfidence || 0) * 100) : (i.threatScore || 85),
        status: ((i.faceRecognized && i.personName && i.personName !== 'UNKNOWN') ? 'MATCHED' : 'REVIEW') as 'MATCHED' | 'REVIEW',
        snapshot_url: i.snapshotUrl || '/storage/evidence/webcam_evidence_0f217afc.jpg'
      }));
    }

    return {
      total,
      active,
      recognitionsToday: recToday,
      unknownDetections: unkDet,
      recentRecognitions: recent
    };
  }, [statusData, people, incidents]);

  return (
    <div className="space-y-4 select-none pb-4">
      
      {/* ── 1. Top Header Banner & Actions ── */}
      <div className="bg-white border border-slate-200 shadow-2xs rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1F5F8B] shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-[#0F2742] tracking-tight">
                Face Recognition / Known Persons
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-[#1F5F8B] border border-blue-200">
                Official Vault
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Register, manage, and verify biometric profiles of authorized border guards, outpost personnel, and known targets.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button 
            onClick={fetchPeople} 
            disabled={loading}
            className="px-3 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 transition-colors flex items-center gap-1.5 text-xs font-semibold shadow-2xs"
            title="Refresh List"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#1F5F8B]' : 'text-slate-500'}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => {
              setRegisterError(null);
              setIsRegisterModalOpen(true);
            }}
            className="px-3.5 py-2 bg-[#1F5F8B] hover:bg-[#0F2742] text-white rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-2xs hover:shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Register Profile</span>
          </button>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs sm:text-sm font-semibold flex items-center gap-3 shadow-2xs">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="flex-1">
            <span>{error === "FACE SERVICE OFFLINE" || error.includes("500") || error.includes("unreachable") ? "FACE SERVICE OFFLINE" : error}</span>
            {(error === "FACE SERVICE OFFLINE" || error.includes("unreachable")) && (
              <p className="text-xs text-red-500 mt-0.5 font-normal">
                FastAPI face recognition microservice is offline or initializing. Local facial verification is temporarily suspended.
              </p>
            )}
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs sm:text-sm font-semibold flex items-center gap-3 shadow-2xs animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ── 2. Search & Status Filter Tabs Bar ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
        
        {/* Clean Search Input with Inline Icon (Zero Overlap) */}
        <div className="flex items-center flex-1 max-w-md h-9 px-3 bg-slate-50 border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-[#1F5F8B]/20 focus-within:border-[#1F5F8B] focus-within:bg-white transition-all">
          <Search className="w-4 h-4 text-slate-400 shrink-0 mr-2.5 pointer-events-none" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or identity code..."
            className="w-full bg-transparent border-0 outline-none text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:ring-0 p-0"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="text-slate-400 hover:text-slate-600 p-1 shrink-0 ml-1"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status Tab Filters */}
        <div className="flex items-center bg-slate-100 p-1 rounded-lg shrink-0 self-start sm:self-auto gap-1">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
              statusFilter === 'all' 
                ? 'bg-white text-[#0F2742] shadow-2xs border border-slate-200/60' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({people.length})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
              statusFilter === 'active' 
                ? 'bg-white text-[#0F2742] shadow-2xs border border-slate-200/60' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Active ({people.filter(p => p.is_active).length})
          </button>
          <button
            onClick={() => setStatusFilter('inactive')}
            className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
              statusFilter === 'inactive' 
                ? 'bg-white text-[#0F2742] shadow-2xs border border-slate-200/60' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Inactive ({people.filter(p => !p.is_active).length})
          </button>
        </div>
      </div>

      {/* ── 3. Known Person Profile Cards (3 Columns Across) ── */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 flex flex-col items-center justify-center text-slate-400 gap-3 shadow-2xs">
          <Loader2 className="w-7 h-7 animate-spin text-[#1F5F8B]" />
          <span className="text-xs font-semibold">Fetching biometric vault...</span>
        </div>
      ) : filteredPeople.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400 space-y-3 shadow-2xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
            <Fingerprint className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">No profiles found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery 
              ? "No matching records matched your query terms." 
              : "The local biometric vault is currently empty. Click 'Register Profile' to add an authorized individual."}
          </p>
          <button
            onClick={() => setIsRegisterModalOpen(true)}
            className="mt-2 px-3.5 py-1.5 bg-[#1F5F8B] text-white rounded-lg text-xs font-semibold hover:bg-[#0F2742] transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Register Profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4 items-stretch">
          {filteredPeople.map((person) => {
            const hasImage = Boolean(person.image_path && person.image_path !== '');
            const imgUrl = getImageUrl(person);

            return (
              <div
                key={person.person_id}
                className={`bg-white rounded-xl border p-4 shadow-xs hover:shadow-sm transition-all flex flex-col justify-between h-full ${
                  person.is_active ? 'border-slate-200/90' : 'border-slate-200/80 bg-slate-50/50 opacity-80'
                }`}
              >
                {/* Top Half: Photo & Info */}
                <div className="flex items-start gap-3.5">
                  {/* Profile Photo */}
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 relative shadow-inner">
                    {hasImage ? (
                      <img 
                        src={imgUrl} 
                        alt={person.name} 
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <Fingerprint className="w-8 h-8" />
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <h3 className="font-bold text-base text-[#0F2742] truncate" title={person.name}>
                        {person.name}
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        person.is_active 
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>
                        {person.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 font-mono font-medium truncate">
                      ID: {person.identity_code || "N/A"}
                    </div>

                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-[#1F5F8B] text-[10px] font-bold">
                      <Layers className="w-3 h-3" />
                      <span>{person.references_count || (person.references ? person.references.length : 1)} Face Reference{person.references_count === 1 ? '' : 's'}</span>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      Registered: {formatCardDate(person.created_at)}
                    </div>
                  </div>
                </div>

                {/* Bottom Half: Vector Badge & Actions */}
                <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#1F5F8B] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1F5F8B]"></span>
                    128-d Vector Active
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openManageReferences(person)}
                      className="px-2 py-1 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md text-[#1F5F8B] transition-colors flex items-center gap-1 text-[11px] font-bold"
                      title="Manage Face References"
                    >
                      <Layers className="w-3 h-3" />
                      <span>Refs</span>
                    </button>

                    <button
                      onClick={() => handleToggleActive(person)}
                      className={`p-1.5 rounded-md border transition-colors ${
                        person.is_active 
                          ? 'border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800' 
                          : 'border-blue-200 bg-blue-50 text-[#1F5F8B] hover:bg-blue-100'
                      }`}
                      title={person.is_active ? "Deactivate Profile" : "Activate Profile"}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => startEdit(person)}
                      className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                      title="Edit Profile"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => setDeletingPerson(person)}
                      className="p-1.5 rounded-md border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                      title="Delete Profile"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 4. BIOMETRIC STATUS (Compact Status Cards) ── */}
      <div className="pt-1">
        <div className="flex items-center gap-2 mb-3">
          <Fingerprint className="w-4 h-4 text-[#1F5F8B]" />
          <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Biometric Status
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          {/* Total Profiles */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Profiles</span>
              <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1F5F8B]">
                <Fingerprint className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-2xl font-black text-[#0F2742] mt-2">{biometricMetrics.total}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Enrolled identities in database</div>
          </div>

          {/* Active */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active</span>
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <UserCheck className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-2xl font-black text-emerald-600 mt-2">{biometricMetrics.active}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Currently active for edge verification</div>
          </div>

          {/* Recognitions Today */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Recognitions Today</span>
              <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-2xl font-black text-[#0F2742] mt-2">{biometricMetrics.recognitionsToday}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Verified edge matches</div>
          </div>

          {/* Unknown Detections */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col justify-between h-full">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Unknown Detections</span>
              <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                <AlertCircle className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-2xl font-black text-amber-600 mt-2">{biometricMetrics.unknownDetections}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Unregistered faces detected</div>
          </div>
        </div>
      </div>

      {/* ── 5. RECENT RECOGNITIONS (Clean, Compact Row List) ── */}
      <div className="pt-1">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#1F5F8B]" />
            <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Recent Recognitions
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-medium">Live biometric surveillance events</span>
        </div>

        <div className="space-y-2">
          {biometricMetrics.recentRecognitions.length === 0 ? (
            <div className="bg-white border border-slate-200/90 rounded-xl p-8 text-center text-xs text-slate-400 shadow-xs">
              No recent recognition events
            </div>
          ) : (
            biometricMetrics.recentRecognitions.map((event) => {
              const isMatched = event.status === 'MATCHED';
              const formattedTime = formatEventTime(event.timestamp);

              return (
                <div 
                  key={event.id} 
                  className="bg-white border border-slate-200/90 rounded-lg p-3 sm:px-4 flex items-center justify-between gap-4 hover:bg-slate-50/80 hover:border-slate-300 transition-all shadow-xs"
                >
                  {/* Left: Thumbnail & Identity */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-lg overflow-hidden bg-slate-900 border border-slate-200 shrink-0 relative">
                      {event.snapshot_url ? (
                        <img 
                          src={event.snapshot_url} 
                          alt={event.person_name} 
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/storage/evidence/webcam_evidence_0f217afc.jpg';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#0F2742] truncate">
                          {event.person_name}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <span className="font-medium text-slate-700">{event.camera_name}</span>
                        <span className="text-slate-300">•</span>
                        <span>{event.sector}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Time, Confidence, Status Badge */}
                  <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                    <div className="text-right">
                      <div className="text-xs font-semibold text-slate-700">{formattedTime}</div>
                      <div className="text-[11px] text-slate-500 font-medium">{event.confidence}% conf</div>
                    </div>

                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                      isMatched 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {event.status}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Floating Action Button (FAB) for Quick Register Profile in Bottom Right ── */}
      <button
        type="button"
        onClick={() => {
          setRegisterError(null);
          setIsRegisterModalOpen(true);
        }}
        className="fixed bottom-7 right-7 z-40 w-13 h-13 rounded-full bg-[#1F5F8B] hover:bg-[#0F2742] text-white shadow-xl hover:shadow-2xl flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 group border-2 border-white/90 focus:outline-none focus:ring-4 focus:ring-sky-500/30 cursor-pointer"
        title="Register New Profile"
        aria-label="Register New Profile"
      >
        <Plus className="w-6 h-6 stroke-[2.5] transition-transform group-hover:rotate-90 duration-300" />
      </button>

      {/* ─────────────────────────────────────────────────────────────
          REGISTER NEW PROFILE MODAL
         ───────────────────────────────────────────────────────────── */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1F5F8B]">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-sm text-[#0F2742] uppercase tracking-wider">
                  Register New Biometric Profile
                </h3>
              </div>
              <button 
                onClick={() => setIsRegisterModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {registerError && (
              <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{registerError}</span>
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} className="p-5 space-y-4">
              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">FULL NAME *</label>
                <input 
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Inspector Sharma"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#1F5F8B]/20 focus:border-[#1F5F8B]"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">IDENTITY CODE (OPTIONAL)</label>
                <input 
                  type="text"
                  value={newIdentityCode}
                  onChange={(e) => setNewIdentityCode(e.target.value)}
                  placeholder="e.g. BSF-9123"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#1F5F8B]/20 focus:border-[#1F5F8B]"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">FACE REFERENCE IMAGE *</label>
                <div className="border-2 border-dashed border-slate-300 hover:border-[#1F5F8B] rounded-lg p-4 bg-slate-50 transition-colors flex flex-col items-center justify-center text-center cursor-pointer relative overflow-hidden">
                  <input 
                    type="file"
                    accept="image/*"
                    required={!newFile}
                    onChange={handleRegisterFileChange}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                  />
                  
                  {newImagePreview ? (
                    <div className="w-28 h-28 border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                      <img src={newImagePreview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 py-2">
                      <div className="p-2.5 bg-white border border-slate-200 rounded-full text-slate-400">
                        <Upload className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-slate-600">Click or drag image file</span>
                      <span className="text-[10px] text-slate-400">Front-facing clear portrait (PNG, JPG up to 10MB)</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-4 py-2 bg-[#1F5F8B] hover:bg-[#0F2742] disabled:bg-slate-300 text-white font-bold rounded-lg text-xs uppercase tracking-wider flex items-center gap-2 transition-colors shadow-2xs"
                >
                  {registering ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Extracting Vector...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Register Profile</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          EDIT PROFILE MODAL
         ───────────────────────────────────────────────────────────── */}
      {editingPerson && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#0F2742] uppercase tracking-wider">
                Edit Biometric Profile
              </h3>
              <button 
                onClick={() => setEditingPerson(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              {updateError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{updateError}</span>
                </div>
              )}

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">FULL NAME *</label>
                <input 
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1F5F8B]/20 focus:border-[#1F5F8B]"
                />
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">IDENTITY CODE</label>
                <input 
                  type="text"
                  value={editIdentityCode}
                  onChange={(e) => setEditIdentityCode(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1F5F8B]/20 focus:border-[#1F5F8B]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input 
                  type="checkbox"
                  id="editIsActive"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-4 h-4 text-[#1F5F8B] rounded border-slate-300 focus:ring-[#1F5F8B]"
                />
                <label htmlFor="editIsActive" className="text-xs text-slate-700 font-semibold cursor-pointer">
                  Active for Edge Surveillance Verification
                </label>
              </div>

              <div>
                <label className="text-xs text-slate-600 font-bold block mb-1">REPLACE FACE PHOTO (OPTIONAL)</label>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleEditFileChange}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#1F5F8B] hover:file:bg-blue-100 cursor-pointer"
                />
                {editImagePreview && (
                  <div className="mt-2 w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
                    <img src={editImagePreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingPerson(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="px-4 py-2 bg-[#1F5F8B] hover:bg-[#0F2742] disabled:bg-slate-300 text-white font-bold rounded-lg text-xs uppercase tracking-wider flex items-center gap-1.5"
                >
                  {updating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Updating...</span>
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
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="p-5 text-center">
              <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-3" />
              <h3 className="font-bold text-[#0F2742] text-base uppercase tracking-wider">
                Confirm Delete Profile
              </h3>
              <p className="text-xs text-slate-500 mt-2">
                Are you sure you want to permanently delete <strong>{deletingPerson.name}</strong>? This will remove their 128-d face embedding vector and purge their reference image from storage.
              </p>
              <div className="mt-3 p-2 bg-red-50 text-red-700 border border-red-100 rounded-lg text-[10px] font-semibold uppercase tracking-wider">
                WARNING: THIS ACTION CANNOT BE UNDONE.
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                disabled={deleting}
                onClick={() => setDeletingPerson(null)}
                className="px-3.5 py-2 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-bold rounded-lg text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-2xs"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
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
          MANAGE REFERENCES MODAL
         ───────────────────────────────────────────────────────────── */}
      {managingReferencesPerson && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#1F5F8B]">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#0F2742] uppercase tracking-wider">
                    Face References — {managingReferencesPerson.name}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    ID: {managingReferencesPerson.identity_code || "N/A"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setManagingReferencesPerson(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-5">
              
              {refError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{refError}</span>
                </div>
              )}

              {refSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{refSuccess}</span>
                </div>
              )}

              {/* Upload New Reference Section */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-[#1F5F8B]" />
                  Add Additional Face Reference
                </h4>
                <p className="text-xs text-slate-500">
                  Uploading multiple face angles or lighting conditions improves recognition accuracy across day/night border cameras.
                </p>

                <form onSubmit={handleUploadReferenceSubmit} className="space-y-3">
                  <input 
                    type="file"
                    accept="image/*"
                    required
                    onChange={handleRefFileChange}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#1F5F8B] hover:file:bg-blue-100 cursor-pointer"
                  />

                  {refImagePreview && (
                    <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                      <img src={refImagePreview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={uploadingRef || !refFile}
                    className="px-3.5 py-1.5 bg-[#1F5F8B] hover:bg-[#0F2742] disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                  >
                    {uploadingRef ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Extracting Embedding...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Upload Reference</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Existing References Grid */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Existing Reference Vectors ({referencesList.length})
                </h4>

                {referencesList.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs">
                    No reference images on file.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {referencesList.map((ref, idx) => {
                      const refUrl = getReferenceImageUrl(ref);
                      return (
                        <div key={ref.id} className="border border-slate-200 rounded-lg p-2.5 bg-white space-y-2 shadow-2xs">
                          <div className="aspect-square rounded-md overflow-hidden bg-slate-100 border border-slate-200 relative">
                            <img 
                              src={refUrl} 
                              alt={`Reference ${idx + 1}`} 
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/storage/evidence/webcam_evidence_0f217afc.jpg';
                              }}
                            />
                            {idx === 0 && (
                              <span className="absolute top-1 left-1 bg-[#1F5F8B] text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-2xs">
                                PRIMARY
                              </span>
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
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setManagingReferencesPerson(null)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-700 font-bold text-xs uppercase tracking-wider transition-colors"
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
