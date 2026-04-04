import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  addDoc, 
  getDoc, 
  doc, 
  serverTimestamp, 
  onSnapshot,
  query,
  where,
  orderBy,
  getDocFromServer,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Share2, 
  Image as ImageIcon, 
  Loader2, 
  LogOut, 
  LogIn, 
  BookOpen, 
  ChevronRight,
  ArrowLeft,
  Copy,
  Check,
  AlertTriangle,
  Send,
  RotateCw,
  MessageSquare,
  Trash2,
  Edit,
  Save,
  X,
  Sparkles
} from 'lucide-react';
import { db, auth, login, logout } from './lib/firebase';
import { cn } from './lib/utils';

// --- Constants ---
const ADMIN_EMAIL = 'bluqrguy@gmail.com';

// --- Types ---
interface Flashcard {
  id: string;
  title: string;
  topic: string;
  imageUrl?: string;
  aiResponse: string;
  authorId: string;
  createdAt: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: any[];
  }
}

// --- Helpers ---
const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      try {
        const parsed = JSON.parse(event.error.message);
        setErrorMsg(parsed.error || 'An unexpected error occurred.');
      } catch {
        setErrorMsg(event.error.message || 'An unexpected error occurred.');
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    const isQuotaError = errorMsg.toLowerCase().includes('quota exceeded');
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
        <div className="bg-stone-900 p-8 rounded-[2rem] shadow-2xl max-w-md w-full border border-stone-800 text-center">
          <div className="w-16 h-16 bg-stone-800 rounded-2xl flex items-center justify-center text-stone-400 mx-auto mb-6">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-serif text-stone-100 mb-4">
            {isQuotaError ? 'Daily Limit Reached' : 'Something went wrong'}
          </h2>
          <p className="text-stone-400 mb-8 leading-relaxed">
            {isQuotaError 
              ? "The application has reached its free tier limit for today. This usually resets every 24 hours. Please try again tomorrow."
              : errorMsg}
          </p>
          <div className="space-y-3">
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-stone-100 text-stone-900 rounded-full font-medium hover:bg-white transition-all shadow-lg active:scale-95"
            >
              Try Reloading
            </button>
            {isQuotaError && (
              <p className="text-xs text-stone-600 pt-4">
                Free tier limits: 50k reads, 20k writes per day.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'home' | 'create' | 'view'>('home');
  const [selectedCard, setSelectedCard] = useState<Flashcard | null>(null);
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [sharedCardId, setSharedCardId] = useState<string | null>(null);

  const isAdmin = user?.email === ADMIN_EMAIL;
  const isSharedView = !!sharedCardId && !isAdmin;

  // Check for shared card in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cardId = params.get('card');
    if (cardId) {
      setSharedCardId(cardId);
      loadSharedCard(cardId);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user || !isAdmin) return;

    const q = query(
      collection(db, 'flashcards'),
      where('authorId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedCards = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Flashcard[];
      setCards(fetchedCards);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'flashcards');
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const loadSharedCard = async (id: string) => {
    setLoading(true);
    try {
      const docRef = doc(db, 'flashcards', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setSelectedCard({ id: docSnap.id, ...docSnap.data() } as Flashcard);
        setView('view');
      } else {
        console.error("No such card!");
        setView('home');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `flashcards/${id}`);
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if(error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  };

  useEffect(() => {
    testConnection();
  }, []);

  // Scroll to top when view changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (isSharedView) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-stone-950 text-stone-50 font-sans selection:bg-stone-800 flex flex-col items-center justify-center p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
              <p className="text-stone-500 text-sm animate-pulse">Loading wisdom...</p>
            </div>
          ) : selectedCard ? (
            <div className="max-w-2xl w-full">
              <CardDetail 
                card={selectedCard} 
                onBack={undefined} 
                isGuestView={true}
              />
              <div className="mt-12 text-center">
                <div className="inline-flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity cursor-default">
                  <BookOpen className="w-4 h-4" />
                  <span className="text-xs font-serif tracking-widest uppercase">Nur Flashcards</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-stone-900 rounded-2xl flex items-center justify-center text-stone-700 mx-auto mb-4">
                <BookOpen className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-serif text-stone-300">Card Not Found</h2>
              <p className="text-stone-500 max-w-xs mx-auto">
                The wisdom card you are looking for might have been moved or deleted.
              </p>
              <button 
                onClick={() => {
                  setSharedCardId(null);
                  window.history.pushState({}, '', '/');
                }}
                className="text-stone-400 hover:text-stone-200 text-sm underline underline-offset-4 transition-colors"
              >
                Go to Home
              </button>
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-stone-200">
        {/* Navigation */}
        <nav className="sticky top-0 z-50 bg-stone-50/80 backdrop-blur-md border-b border-stone-200/50 px-6 py-4 flex justify-between items-center">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => {
              setView('home');
              window.history.pushState({}, '', '/');
            }}
          >
            <div className="w-10 h-10 bg-stone-800 rounded-xl flex items-center justify-center text-stone-50 group-hover:scale-105 transition-transform">
              <BookOpen className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-serif font-semibold tracking-tight">Nur Flashcards</h1>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-end">
                  <span className="hidden sm:inline text-sm text-stone-500 font-medium">
                    {user.displayName}
                  </span>
                  {!isAdmin && (
                    <span className="text-[10px] text-red-400 font-bold uppercase tracking-tighter">
                      Not Admin
                    </span>
                  )}
                </div>
                <button 
                  onClick={logout}
                  className="p-2 hover:bg-stone-200 rounded-full transition-colors text-stone-600"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button 
                onClick={login}
                className="flex items-center gap-2 px-5 py-2 bg-stone-800 text-stone-50 rounded-full text-sm font-medium hover:bg-stone-700 transition-all shadow-sm"
              >
                <LogIn className="w-4 h-4" />
                Admin Login
              </button>
            )}
          </div>
        </nav>

        <main className="max-w-4xl mx-auto px-6 py-12">
          <AnimatePresence mode="wait">
            {view === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-12"
              >
                {isAdmin ? (
                  <>
                    <div className="text-center space-y-4">
                      <h2 className="text-4xl sm:text-5xl font-serif font-light text-stone-800">
                        Admin Dashboard
                      </h2>
                      <p className="text-stone-500 max-w-xl mx-auto text-lg">
                        Manage your wisdom cards and share them with the world.
                      </p>
                      <button 
                        onClick={() => setView('create')}
                        className="mt-8 inline-flex items-center gap-2 px-8 py-4 bg-stone-800 text-stone-50 rounded-full font-medium hover:bg-stone-700 transition-all shadow-lg hover:shadow-xl active:scale-95"
                      >
                        <Plus className="w-5 h-5" />
                        Create New Card
                      </button>
                    </div>

                    {cards.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-8">
                        {cards.map((card) => (
                          <CardPreview 
                            key={card.id} 
                            card={card} 
                            onClick={() => {
                              setSelectedCard(card);
                              setView('view');
                              window.history.pushState({}, '', `?card=${card.id}`);
                            }} 
                          />
                        ))}
                      </div>
                    )}

                    {cards.length === 0 && !loading && (
                      <div className="bg-stone-100 rounded-3xl p-12 text-center border border-stone-200/50">
                        <p className="text-stone-500 italic">No flashcards created yet. Start by creating one!</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center space-y-8 py-20">
                    <div className="w-20 h-20 bg-stone-100 rounded-3xl flex items-center justify-center text-stone-300 mx-auto mb-6">
                      <BookOpen className="w-10 h-10" />
                    </div>
                    <h2 className="text-4xl sm:text-5xl font-serif font-light text-stone-800">
                      Nur Flashcards
                    </h2>
                    <p className="text-stone-500 max-w-md mx-auto text-lg leading-relaxed">
                      A collection of wisdom and reflections from the Quran and Hadith, shared through AI-powered flashcards.
                    </p>
                    <div className="pt-8">
                      <p className="text-stone-400 text-sm italic">
                        Please use a direct link shared by the admin to view a specific card.
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}


            {view === 'create' && (
              <motion.div 
                key="create"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-2xl mx-auto"
              >
                <CreateCardForm 
                  onCancel={() => setView('home')} 
                  onSuccess={(card) => {
                    setSelectedCard(card);
                    setView('view');
                    window.history.pushState({}, '', `?card=${card.id}`);
                  }}
                />
              </motion.div>
            )}

            {view === 'view' && selectedCard && (
              <motion.div 
                key="view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto"
              >
                <CardDetail 
                  card={selectedCard} 
                  onBack={() => {
                    setView('home');
                    window.history.pushState({}, '', '/');
                  }} 
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}

// --- Sub-components ---

function CardPreview({ card, onClick }: { card: Flashcard, onClick: () => void }) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      onClick={onClick}
      className="bg-white rounded-3xl p-6 shadow-sm border border-stone-200 cursor-pointer hover:shadow-md transition-all group"
    >
      {card.imageUrl && (
        <div className="aspect-video w-full mb-4 overflow-hidden rounded-2xl bg-stone-100">
          <img 
            src={card.imageUrl} 
            alt={card.title} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <h3 className="text-xl font-serif font-medium text-stone-800 mb-2 truncate">{card.title}</h3>
      <p className="text-stone-500 text-sm line-clamp-2 mb-4">{card.topic}</p>
      <div className="flex items-center text-stone-400 text-xs font-medium uppercase tracking-wider">
        <span>View Details</span>
        <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
      </div>
    </motion.div>
  );
}

function CreateCardForm({ onCancel, onSuccess }: { onCancel: () => void, onSuccess: (card: Flashcard) => void }) {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const generateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !topic || loading) return;

    setLoading(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("Gemini API key is missing. Please check your environment configuration.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Use gemini-flash-latest for broader compatibility
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `You are a wise narrator. Provide a concise, gentle, and insightful explanation of the key concepts, references, and stories in the Quran and Hadith on the topic: "${topic}". 

Rules for your response:
1. Use a wise and patient tone.
2. do NOT address the reader directly (avoid phrases like "My dear child", "Listen closely", or "I hope you find this helpful"). 
3. Focus strictly on the wisdom and knowledge itself.
4. Whenever you reference or quote from the Quran or Hadith, you MUST:
   - Provide the original Arabic text wrapped in an HTML div with the class "arabic-text" (e.g., <div class="arabic-text">...</div>).
   - Provide the English translation.
   - Provide the specific reference number (e.g., Surah Name/Number:Ayah Number for Quran, or the specific collection and Hadith number for Hadith).
5. Use Markdown for formatting.`,
      });

      if (!response.text) {
        console.error("AI Response was empty or blocked:", response);
        throw new Error("The wisdom could not be found for this topic. Please try rephrasing your request.");
      }

      const aiResponse = response.text;

      const cardData = {
        title,
        topic,
        imageUrl: image || null,
        aiResponse,
        authorId: auth.currentUser!.uid,
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'flashcards'), cardData);
      
      onSuccess({
        id: docRef.id,
        ...cardData,
        createdAt: new Date() // Temporary client-side date
      } as Flashcard);

    } catch (error) {
      console.error("Generation Error:", error);
      // Distinguish between AI errors and Firestore errors
      if (error instanceof Error && (error.message.includes("Gemini") || error.message.includes("wisdom"))) {
        throw error; // Let ErrorBoundary handle it with the specific message
      }
      handleFirestoreError(error, OperationType.WRITE, 'flashcards');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-[2rem] p-8 sm:p-12 shadow-xl border border-stone-200">
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onCancel}
          className="p-2 hover:bg-stone-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-stone-500" />
        </button>
        <h2 className="text-2xl font-serif font-semibold text-stone-800">Create New Wisdom Card</h2>
      </div>

      <form onSubmit={generateCard} className="space-y-8">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Card Title</label>
          <input 
            type="text" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., The Beauty of Patience"
            className="w-full bg-stone-50 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-stone-200 transition-all text-lg"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Topic or Question</label>
          <textarea 
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Describe what you want to explore..."
            className="w-full bg-stone-50 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-stone-200 transition-all min-h-[150px] text-lg resize-none"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-stone-400">Attach Image (Optional)</label>
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "w-full aspect-video rounded-2xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center cursor-pointer hover:border-stone-300 hover:bg-stone-50 transition-all overflow-hidden",
              image && "border-solid border-stone-800"
            )}
          >
            {image ? (
              <img src={image} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <>
                <ImageIcon className="w-10 h-10 text-stone-300 mb-2" />
                <span className="text-stone-400 text-sm">Click to upload an image</span>
              </>
            )}
          </div>
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleImageChange}
            accept="image/*"
            className="hidden"
          />
        </div>

        <div className="pt-4 flex gap-4">
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 px-6 rounded-full font-medium text-stone-600 hover:bg-stone-100 transition-colors"
          >
            Cancel
          </button>
          <button 
            type="submit"
            disabled={loading}
            className="flex-[2] py-4 px-6 bg-stone-800 text-stone-50 rounded-full font-medium hover:bg-stone-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating Wisdom...
              </>
            ) : (
              'Generate Card'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function CardDetail({ card, onBack, isGuestView }: { card: Flashcard, onBack?: () => void, isGuestView?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [followUpQuery, setFollowUpQuery] = useState('');
  const [followUpResponse, setFollowUpResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editTopic, setEditTopic] = useState(card.topic);
  const [editImageUrl, setEditImageUrl] = useState(card.imageUrl || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = auth.currentUser?.email === ADMIN_EMAIL;
  const isOwner = auth.currentUser?.uid === card.authorId;
  const canModify = isAdmin || isOwner;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Reset follow-up state when card changes
  useEffect(() => {
    setIsFlipped(false);
    setFollowUpQuery('');
    setFollowUpResponse('');
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setError(null);
    setEditTitle(card.title);
    setEditTopic(card.topic);
    setEditImageUrl(card.imageUrl || '');
  }, [card.id, card.title, card.topic, card.imageUrl]);

  const shareUrl = `${window.location.origin}/?card=${card.id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    setIsUpdating(true);
    setError(null);
    try {
      await deleteDoc(doc(db, 'flashcards', card.id));
      onBack?.();
    } catch (err) {
      console.error("Delete Error:", err);
      setError("Failed to delete the card. Please try again.");
      handleFirestoreError(err, OperationType.DELETE, 'flashcards');
    } finally {
      setIsUpdating(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleUpdate = async (regenerate = false) => {
    if (!editTitle.trim() || !editTopic.trim()) return;
    
    setIsUpdating(true);
    setError(null);
    try {
      let aiResponse = card.aiResponse;
      
      if (regenerate) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("API Key is missing.");
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-flash-latest",
          contents: `You are a wise narrator. Provide a concise, gentle, and insightful explanation of the key concepts, references, and stories in the Quran and Hadith on the topic: "${editTopic}". 
  
          Rules for your response:
          1. Use a wise and patient tone.
          2. do NOT address the reader directly.
          3. Focus strictly on the wisdom and knowledge itself.
          4. Whenever you reference or quote from the Quran or Hadith, you MUST:
             - Provide the original Arabic text wrapped in an HTML div with the class "arabic-text".
             - Provide the English translation.
             - Provide the specific reference number.
          5. Use Markdown for formatting.`,
        });
        if (!response.text) throw new Error("The wisdom could not be found.");
        aiResponse = response.text;
      }

      await updateDoc(doc(db, 'flashcards', card.id), {
        title: editTitle,
        topic: editTopic,
        imageUrl: editImageUrl || null,
        aiResponse
      });
      
      setIsEditing(false);
    } catch (err) {
      console.error("Update Error:", err);
      setError("Failed to update the card. Please try again.");
      handleFirestoreError(err, OperationType.UPDATE, 'flashcards');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpQuery.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key is missing.");

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `You are a wise narrator. The user is asking a follow-up question about the wisdom you previously shared on the topic "${card.topic}". 
        
        Original Wisdom Shared:
        ${card.aiResponse}

        User's Follow-up Question:
        "${followUpQuery}"

        Rules for your response:
        1. Use a wise and patient tone.
        2. Provide a VERY concise, gentle, and insightful explanation. Your response MUST be brief (maximum 150 words) to ensure it fits perfectly on a single flashcard side without scrolling.
        3. do NOT address the reader directly.
        4. Focus strictly on the wisdom and knowledge itself.
        5. Whenever you reference or quote from the Quran or Hadith, you MUST:
           - Provide the original Arabic text wrapped in an HTML div with the class "arabic-text".
           - Provide the English translation.
           - Provide the specific reference number.
        6. Use Markdown for formatting.`,
      });

      if (!response.text) throw new Error("The wisdom could not be found.");

      setFollowUpResponse(response.text);
      setIsFlipped(true);
      setFollowUpQuery('');
    } catch (err) {
      console.error("Follow-up Generation Error:", err);
      setError("I was unable to find further wisdom at this moment. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-8">
      {!isGuestView && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4 justify-between items-center">
            <button 
              onClick={onBack}
              className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors font-medium"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Collection
            </button>
            <div className="flex flex-wrap gap-2">
              {canModify && !isEditing && !showDeleteConfirm && (
                <>
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-full text-sm font-medium hover:bg-stone-50 transition-all shadow-sm text-stone-600"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button 
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-red-100 rounded-full text-sm font-medium hover:bg-red-50 transition-all shadow-sm text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
              {showDeleteConfirm && (
                <div className="flex items-center gap-3 bg-red-50 px-4 py-2 rounded-full border border-red-100 animate-in fade-in slide-in-from-right-4">
                  <span className="text-sm font-medium text-red-800">Delete this card?</span>
                  <button 
                    onClick={handleDelete}
                    disabled={isUpdating}
                    className="text-sm font-bold text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Yes, Delete
                  </button>
                  <div className="w-px h-4 bg-red-200" />
                  <button 
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isUpdating}
                    className="text-sm font-medium text-stone-500 hover:text-stone-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {isEditing && (
                <>
                  <button 
                    onClick={() => handleUpdate(false)}
                    disabled={isUpdating}
                    className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white rounded-full text-sm font-medium hover:bg-stone-700 transition-all shadow-sm disabled:opacity-50"
                  >
                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                  </button>
                  <button 
                    onClick={() => handleUpdate(true)}
                    disabled={isUpdating}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-full text-sm font-medium hover:bg-amber-700 transition-all shadow-sm disabled:opacity-50"
                    title="Update and regenerate AI response"
                  >
                    {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Save & Regenerate
                  </button>
                  <button 
                    onClick={() => setIsEditing(false)}
                    disabled={isUpdating}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-full text-sm font-medium hover:bg-stone-50 transition-all shadow-sm text-stone-600 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                </>
              )}
              {!isEditing && !showDeleteConfirm && (
                <>
                  <button 
                    onClick={handleCopy}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-full text-sm font-medium hover:bg-stone-50 transition-all shadow-sm"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Link Copied' : 'Copy Link'}
                  </button>
                  <a 
                    href={`https://wa.me/?text=${encodeURIComponent(`Check out this wisdom card: ${shareUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-10 h-10 bg-[#25D366] text-white rounded-full hover:opacity-90 transition-all shadow-sm"
                    title="Share to WhatsApp"
                  >
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                  </a>
                </>
              )}
            </div>
          </div>
          
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-800 text-sm"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <p>{error}</p>
                <button 
                  onClick={() => setError(null)}
                  className="ml-auto p-1 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="perspective-1000 relative w-full">
        <motion.div 
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
          style={{ transformStyle: "preserve-3d" }}
          className="relative w-full cursor-pointer"
          onClick={() => !isEditing && followUpResponse && setIsFlipped(!isFlipped)}
        >
          {/* Front Side */}
          <div 
            className={cn(
              "relative z-10 backface-hidden rounded-[2.5rem] overflow-hidden shadow-2xl border border-stone-800 flex flex-col bg-stone-900 min-h-[600px]",
              isGuestView && "border-white/10"
            )}
            style={{ backfaceVisibility: "hidden" }}
          >
            {(editImageUrl || card.imageUrl) && (
              <div 
                className="absolute inset-0 z-0"
                style={{ 
                  backgroundImage: `url(${isEditing ? editImageUrl : card.imageUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]" />
              </div>
            )}
            
            <div className="relative z-10 p-4 sm:p-8 flex-1 flex flex-col justify-end">
              <div className={cn(
                "space-y-8 max-w-3xl w-full p-8 sm:p-12 rounded-[2.5rem] shadow-2xl text-white",
                (isEditing ? editImageUrl : card.imageUrl) 
                  ? "bg-stone-900/40 backdrop-blur-xl border border-white/10" 
                  : "bg-stone-800/50 border border-white/5"
              )} onClick={(e) => isEditing && e.stopPropagation()}>
                {isEditing ? (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">Title</label>
                      <input 
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/40 outline-none transition-all"
                        placeholder="Card Title"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">Topic</label>
                      <textarea 
                        value={editTopic}
                        onChange={(e) => setEditTopic(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-white/40 outline-none transition-all min-h-[100px]"
                        placeholder="Topic for wisdom generation"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-widest text-white/60">Background Image</label>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "w-full aspect-video rounded-2xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-white/40 hover:bg-white/5 transition-all overflow-hidden",
                          editImageUrl && "border-solid border-white/40"
                        )}
                      >
                        {editImageUrl ? (
                          <img src={editImageUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <>
                            <ImageIcon className="w-8 h-8 text-white/20 mb-2" />
                            <span className="text-white/40 text-xs">Click to upload a new image</span>
                          </>
                        )}
                      </div>
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleImageChange}
                        accept="image/*"
                        className="hidden"
                      />
                      <div className="flex items-center gap-2 pt-2">
                        <input 
                          type="text"
                          value={editImageUrl}
                          onChange={(e) => setEditImageUrl(e.target.value)}
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white/40 focus:ring-1 focus:ring-white/20 outline-none transition-all"
                          placeholder="Or paste image URL here..."
                        />
                        {editImageUrl && (
                          <button 
                            onClick={() => setEditImageUrl('')}
                            className="p-2 hover:bg-white/10 rounded-lg text-white/40 transition-colors"
                            title="Remove Image"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <h2 className="text-4xl sm:text-5xl font-serif font-bold leading-tight text-white">
                        {card.title}
                      </h2>
                      <p className="text-sm font-medium uppercase tracking-widest text-white/80">
                        Topic: {card.topic}
                      </p>
                    </div>

                    <div className="w-full h-px bg-white/20" />

                    <div className="space-y-6">
                      {card.aiResponse.split(/(?=^#{1,6}\s)/m).filter(s => s.trim()).map((section, idx) => (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="p-6 rounded-2xl border border-white/20 bg-white/5 backdrop-blur-sm prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white prose-headings:font-serif"
                        >
                          <Markdown rehypePlugins={[rehypeRaw]}>{section}</Markdown>
                        </motion.div>
                      ))}
                    </div>

                    <div className="pt-8 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-md">
                          <BookOpen className="w-6 h-6 text-white" />
                        </div>
                        <p className="text-sm italic text-white/80">
                          A reflection shared through Nur Flashcards.
                        </p>
                      </div>
                      {followUpResponse && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-medium transition-colors border border-white/10">
                          <RotateCw className="w-4 h-4" />
                          View Follow-up
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Back Side */}
          <div 
            className={cn(
              "absolute inset-0 backface-hidden rounded-[2.5rem] overflow-hidden shadow-2xl border border-stone-800 flex flex-col bg-stone-900",
              isGuestView && "border-white/10"
            )}
            style={{ 
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)"
            }}
          >
            {(editImageUrl || card.imageUrl) && (
              <div 
                className="absolute inset-0 z-0"
                style={{ 
                  backgroundImage: `url(${isEditing ? editImageUrl : card.imageUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]" />
              </div>
            )}
            
            <div className="relative z-10 p-4 sm:p-8 h-full flex flex-col justify-start">
              <div className="flex justify-start mb-4">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsFlipped(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-medium transition-colors border border-white/10 text-white backdrop-blur-md"
                >
                  <RotateCw className="w-4 h-4" />
                  Flip Back to Original
                </button>
              </div>

              <div 
                className={cn(
                  "space-y-8 max-w-3xl w-full p-8 sm:p-12 rounded-[2.5rem] shadow-2xl text-white",
                  (isEditing ? editImageUrl : card.imageUrl) 
                    ? "bg-stone-900/40 backdrop-blur-xl border border-white/10" 
                    : "bg-stone-800/50 border border-white/5"
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="w-6 h-6 text-white/60" />
                    <h3 className="text-2xl font-serif font-bold text-white">Follow-up Wisdom</h3>
                  </div>
                </div>

                <div className="w-full h-px bg-white/20" />

                <div className="space-y-6 text-left">
                  {followUpResponse ? (
                    <div className="prose prose-invert max-w-none prose-p:text-white/90 prose-headings:text-white prose-headings:font-serif">
                      <Markdown rehypePlugins={[rehypeRaw]}>{followUpResponse}</Markdown>
                    </div>
                  ) : (
                    <p className="text-white/60 italic text-center">Ask a question below to reveal more wisdom...</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Chatbox at the bottom */}
      {!isEditing && (
        <div className="max-w-3xl mx-auto w-full">
          <form 
            onSubmit={handleFollowUp}
            className="relative group"
          >
            <input 
              type="text"
              value={followUpQuery}
              onChange={(e) => setFollowUpQuery(e.target.value)}
              placeholder="Ask a follow-up question about this wisdom..."
              className="w-full py-5 pl-8 pr-20 bg-white border border-stone-200 rounded-[2rem] shadow-lg focus:ring-2 focus:ring-stone-800 focus:border-transparent outline-none transition-all text-stone-800 placeholder:text-stone-400"
            />
            <button 
              type="submit"
              disabled={isGenerating || !followUpQuery.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 bg-stone-800 text-white rounded-full flex items-center justify-center hover:bg-stone-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              {isGenerating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
          <p className="text-center text-stone-400 text-xs mt-4">
            Ask for clarification, deeper meaning, or related stories.
          </p>
        </div>
      )}
    </div>
  );
}
