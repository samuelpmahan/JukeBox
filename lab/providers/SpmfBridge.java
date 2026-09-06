/** Small process bridge to unmodified upstream SPMF algorithms. */
import ca.pfv.spmf.algorithms.sequentialpatterns.skopus.AlgoSkopus;
import ca.pfv.spmf.algorithms.sequentialpatterns.clasp_AGP.AlgoClaSP;
import ca.pfv.spmf.algorithms.sequentialpatterns.clasp_AGP.dataStructures.creators.AbstractionCreator_Qualitative;
import ca.pfv.spmf.algorithms.sequentialpatterns.clasp_AGP.idlists.creators.IdListCreatorStandard_Map;
import ca.pfv.spmf.algorithms.sequentialpatterns.clasp_AGP.dataStructures.database.SequenceDatabase;
public class SpmfBridge {
 public static void main(String[] args) throws Exception {
  if (args[0].equals("skopus")) {
   AlgoSkopus algorithm=new AlgoSkopus();
   algorithm.runAlgorithm(args[1],args[2],true,false,false,0.0,Integer.parseInt(args[4]),Integer.parseInt(args[3]));
   algorithm.printStats();
  } else if(args[0].equals("closed")) {
   var abstraction=AbstractionCreator_Qualitative.getInstance();
   var sd=new SequenceDatabase(abstraction,IdListCreatorStandard_Map.getInstance());
   double minimum=sd.loadFile(args[1],Double.parseDouble(args[3]));
   var algorithm=new AlgoClaSP(minimum,abstraction,true,false);
   algorithm.runAlgorithm(sd,true,false,args[2],true);
   System.out.println(algorithm.printStatistics());
  } else throw new IllegalArgumentException("Unknown method: "+args[0]);
 }
}
